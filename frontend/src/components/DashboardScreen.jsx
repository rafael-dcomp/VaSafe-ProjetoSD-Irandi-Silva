import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = "http://98.90.117.5:8000";

export default function DashboardScreen({ estoqueConfig = [], onSelectCaixa }) {
  const [resumoEstoque, setResumoEstoque] = useState({});

  const toggleManutencao = async (boxId, estadoAtualOn, e) => {
    e.stopPropagation();

    const comando = estadoAtualOn ? "MANUTENCAO_OFF" : "MANUTENCAO_ON";
    const novoStatus = !estadoAtualOn;

    setResumoEstoque(prev => ({
      ...prev,
      [boxId]: {
        ...prev[boxId],
        emManutencao: novoStatus
      }
    }));

    try {
      await axios.post(`${API_URL}/controle/${boxId}`, { comando });
    } catch (error) {
      console.error("Erro ao enviar comando", error);
      alert("Erro ao enviar comando de controle.");

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
          const modoRemotoAtivo = ultimoDado.modo === "MANUTENCAO_ONLINE"; 

          novos[item.id] = {
            score: analise.health_score ?? null,
            status_operacional: analise.status_operacional ?? null,
            temp: typeof tele.temperatura_atual === 'number' ? tele.temperatura_atual : null,
            violacao: tele?.violacao ?? false,
            tampa_aberta: tele?.tampa_aberta ?? false,
            historico: tele?.historico ?? [],
            erro: false,
            emManutencao: resumoEstoque[item.id]?.emManutencao || modoRemotoAtivo || false
          };
        } catch (err) {
          novos[item.id] = {
            score: null,
            status_operacional: null,
            temp: null,
            violacao: false,
            tampa_aberta: false,
            historico: [],
            erro: true,
            emManutencao: resumoEstoque[item.id]?.emManutencao || false
          };
        }
      })
    );

    setResumoEstoque(novos);
  }, [estoqueConfig, resumoEstoque]);

  useEffect(() => {
    fetchVisaoGeral();
    const id = setInterval(fetchVisaoGeral, 3000);
    return () => clearInterval(id);
  }, []); 

  const formatTemp = (t) =>
    (typeof t === 'number' && !Number.isNaN(t)) ? `${t.toFixed(1)}°C` : '--';

  return (
    <div className="menu-container">
      <h2 style={{ color: '#1e293b', marginBottom: 20 }}>Visão Geral dos Lotes</h2>

      <div className="caixa-grid">
        {(estoqueConfig || []).map((item) => {
          const dados = resumoEstoque[item.id];
          const score = dados ? dados.score : null;

          let corStatus = '#cbd5e1'; 
          let statusLabel = 'AGUARDANDO';
          let classeAnimacao = 'status-offline';
          let icone = '❄️';

          if (!dados || dados.erro || dados.status_operacional === 'OFFLINE') {
             corStatus = '#94a3b8';
             statusLabel = 'OFFLINE';
             classeAnimacao = 'status-offline';
             icone = '📡';
          } else if (dados.violacao || dados.tampa_aberta) {
             corStatus = '#ef4444';
             statusLabel = 'VIOLAÇÃO';
             classeAnimacao = 'status-danger';
             icone = '🚨';
          } else if (dados.temp !== null && (dados.temp < 2.0 || dados.temp > 8.0)) {
             corStatus = '#eab308';
             statusLabel = 'ALERTA';
             classeAnimacao = 'status-warning';
             icone = '⚠️';
          } else {
             corStatus = '#22c55e';
             statusLabel = score !== null ? `${score}% Saúde` : 'ESTÁVEL';
             classeAnimacao = 'status-ok';
             icone = '❄️';
          }

          const isOfflineOrAguardando = dados?.erro === true 
            || dados?.status_operacional === 'AGUARDANDO' 
            || dados?.status_operacional === 'OFFLINE';

          return (
            <div
              key={item.id}
              className={`caixa-card ${classeAnimacao}`}
              onClick={() => onSelectCaixa(item.id)}
              style={{ borderTop: `6px solid ${corStatus}` }}
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
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 15 }}>
                {item.conteudo} • {item.local}
              </p>

              <div className="caixa-stats-row">
                <div className="stat-item">
                  <small>Temperatura</small>
                  <strong>
                    {!isOfflineOrAguardando && dados && dados.temp !== null
                      ? formatTemp(dados.temp)
                      : '--'}
                  </strong>
                </div>
                
                <div className="stat-item">
                  <small>Status</small>
                  <strong style={{ color: corStatus }}>
                    {statusLabel}
                  </strong>
                </div>

                <div className="stat-item">
                  <small>ID</small>
                  <span style={{ fontSize: '0.8rem' }}>{item.id}</span>
                </div>
              </div>
              <div style={{ 
                  marginTop: 15, 
                  borderTop: '1px solid #eee', 
                  paddingTop: 10, 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center' 
              }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Modo Remoto
                </span>
                
                <button
                    onClick={(e) => toggleManutencao(item.id, dados?.emManutencao, e)}
                    style={{
                        backgroundColor: dados?.emManutencao ? '#22c55e' : '#cbd5e1',
                        color: dados?.emManutencao ? 'white' : '#64748b',
                        border: 'none',
                        borderRadius: '20px',
                        padding: '5px 15px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '0.75rem',
                        transition: 'background-color 0.3s',
                        boxShadow: dados?.emManutencao ? '0 2px 5px rgba(34, 197, 94, 0.4)' : 'none'
                    }}
                >
                    {dados?.emManutencao ? 'ONLINE (TWIN)' : 'AUTO (ECO)'}
                </button>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}