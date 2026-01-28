import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = "http://98.90.117.5:8000";

export default function DashboardScreen({ estoqueConfig = [], onSelectCaixa }) {
  const [resumoEstoque, setResumoEstoque] = useState({});
  const [manualOverrides, setManualOverrides] = useState({});

  const styles = {
    switchContainer: {
      position: 'relative',
      display: 'inline-block',
      width: '44px',
      height: '24px',
    },
    switchInput: {
      opacity: 0,
      width: 0,
      height: 0,
    },
    slider: (checked) => ({
      position: 'absolute',
      cursor: 'pointer',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: checked ? '#22c55e' : '#cbd5e1', 
      transition: '.4s',
      borderRadius: '34px',
    }),
    sliderBefore: (checked) => ({
      position: 'absolute',
      content: '""',
      height: '18px',
      width: '18px',
      left: checked ? '22px' : '4px', 
      bottom: '3px',
      backgroundColor: 'white',
      transition: '.4s',
      borderRadius: '50%',
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
    })
  };

  const toggleManutencao = async (boxId, estadoAtualOn, e) => {
    e.stopPropagation();

    const comando = estadoAtualOn ? "MANUTENCAO_OFF" : "MANUTENCAO_ON";
    const novoStatus = !estadoAtualOn;

    setManualOverrides(prev => ({
        ...prev,
        [boxId]: {
            active: novoStatus,
            expires: Date.now() + 30000 
        }
    }));

    setResumoEstoque(prev => ({
      ...prev,
      [boxId]: {
        ...prev[boxId],
        emManutencao: novoStatus
      }
    }));

    try {
      await axios.post(`${API_URL}/controle/${boxId}`, { comando });
      console.log(`Comando ${comando} enviado com sucesso.`);
    } catch (error) {
      console.error("Erro ao enviar comando", error);
      alert("Erro de conexão. O comando não foi enviado.");
      setManualOverrides(prev => {
          const copy = { ...prev };
          delete copy[boxId];
          return copy;
      });
      setResumoEstoque(prev => ({
        ...prev,
        [boxId]: { ...prev[boxId], emManutencao: estadoAtualOn }
      }));
    }
  };

  const fetchVisaoGeral = useCallback(async () => {
    const t = Date.now();
    const novos = {};

    await Promise.all(
      (estoqueConfig || []).map(async (item) => {
        try {
          const res = await axios.get(`${API_URL}/analise/${item.id}?t=${t}`);
          const analise = res.data?.analise_risco ?? {};
          const tele = res.data?.telemetria ?? {};
          const ultimoDado = tele.historico && tele.historico.length > 0 ? tele.historico[0] : {};
          const modoBackendAtivo = ultimoDado.modo === "MANUTENCAO_ONLINE"; 
          let statusFinalSwitch = modoBackendAtivo;
          
          if (manualOverrides[item.id]) {
              if (Date.now() < manualOverrides[item.id].expires) {
                  statusFinalSwitch = manualOverrides[item.id].active;
              } else {
              }
          }

          novos[item.id] = {
            score: analise.health_score ?? null,
            status_operacional: analise.status_operacional ?? null,
            temp: typeof tele.temperatura_atual === 'number' ? tele.temperatura_atual : null, 
            violacao: tele?.violacao ?? false,
            tampa_aberta: tele?.tampa_aberta ?? false,
            historico: tele?.historico ?? [],
            erro: false,
            emManutencao: statusFinalSwitch 
          };
        } catch (err) {
          const statusAtual = resumoEstoque[item.id]?.emManutencao || false;
          novos[item.id] = {
            score: null, status_operacional: null, temp: null, violacao: false, tampa_aberta: false, historico: [], erro: true,
            emManutencao: statusAtual
          };
        }
      })
    );
    setResumoEstoque(novos);
  }, [estoqueConfig, manualOverrides, resumoEstoque]);

  useEffect(() => {
    fetchVisaoGeral();
    const id = setInterval(fetchVisaoGeral, 3000); 
    return () => clearInterval(id);
  }, [fetchVisaoGeral]);

  const formatTemp = (t) => (typeof t === 'number' && !Number.isNaN(t)) ? `${t.toFixed(1)}°C` : '--';

  return (
    <div className="menu-container">
      <h2 style={{ color: '#1e293b', marginBottom: 20 }}>Monitoramento de Lotes</h2>

      <div className="caixa-grid">
        {(estoqueConfig || []).map((item) => {
          const dados = resumoEstoque[item.id];
          const score = dados ? dados.score : null;
          let corStatus = '#cbd5e1'; let statusLabel = 'AGUARDANDO'; let classeAnimacao = 'status-offline'; let icone = '❄️';

          if (!dados || dados.erro || dados.status_operacional === 'OFFLINE') {
             corStatus = '#94a3b8'; statusLabel = 'OFFLINE'; classeAnimacao = 'status-offline'; icone = '📡';
          } else if (dados.violacao || dados.tampa_aberta) {
             corStatus = '#ef4444'; statusLabel = 'VIOLAÇÃO'; classeAnimacao = 'status-danger'; icone = '🚨';
          } else if (dados.temp !== null && (dados.temp < 2.0 || dados.temp > 8.0)) {
             corStatus = '#eab308'; statusLabel = 'ALERTA'; classeAnimacao = 'status-warning'; icone = '⚠️';
          } else {
             corStatus = '#22c55e'; statusLabel = score !== null ? `${score}% Saúde` : 'ESTÁVEL'; classeAnimacao = 'status-ok'; icone = '❄️';
          }

          const isOfflineOrAguardando = dados?.erro === true || dados?.status_operacional === 'AGUARDANDO' || dados?.status_operacional === 'OFFLINE';
          const isManutencao = dados?.emManutencao || false;

          return (
            <div
              key={item.id}
              className={`caixa-card ${classeAnimacao}`}
              onClick={() => onSelectCaixa(item.id)}
              style={{ borderTop: `6px solid ${corStatus}`, cursor: 'pointer' }}
            >
              <div className="caixa-header">
                <div className="icon-bg" style={{ backgroundColor: corStatus + '20' }}>
                  <span style={{ fontSize: 20 }}>{icone}</span>
                </div>
                <span className="status-pill" style={{ backgroundColor: corStatus, color: '#fff' }}>
                  {statusLabel}
                </span>
              </div>

              <h3>{item.nome}</h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 15 }}>{item.conteudo} • {item.local}</p>

              <div className="caixa-stats-row">
                <div className="stat-item">
                  <small>Temp.</small>
                  <strong>{!isOfflineOrAguardando && dados && dados.temp !== null ? formatTemp(dados.temp) : '--'}</strong>
                </div>
                <div className="stat-item">
                  <small>Status</small>
                  <strong style={{ color: corStatus }}>{statusLabel}</strong>
                </div>
              </div>

              <div style={{ 
                  marginTop: 20, 
                  backgroundColor: '#f8fafc',
                  padding: '10px',
                  borderRadius: '8px',
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  border: isManutencao ? '1px solid #22c55e' : '1px solid transparent'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#334155' }}>
                        CONEXÃO TEMPO REAL
                    </span>
                    <span style={{ fontSize: '0.65rem', color: isManutencao ? '#22c55e' : '#94a3b8' }}>
                        {isManutencao ? 'Ativo (Alto consumo)' : 'Desativado (Modo Eco)'}
                    </span>
                </div>
                
                <div 
                    style={styles.switchContainer} 
                    onClick={(e) => toggleManutencao(item.id, isManutencao, e)}
                >
                    <div style={styles.slider(isManutencao)}></div>
                    <div style={styles.sliderBefore(isManutencao)}></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}