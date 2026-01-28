import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API_URL = "http://98.90.117.5:8000";

export default function DashboardScreen({ estoqueConfig = [], onSelectCaixa }) {
  const [resumoEstoque, setResumoEstoque] = useState({});

  const [loadingStates, setLoadingStates] = useState({}); 
  const loadingStatesRef = useRef({});
  loadingStatesRef.current = loadingStates;

  const styles = {
    switchContainer: {
      position: 'relative',
      display: 'inline-block',
      width: '44px',
      height: '24px',
      transition: 'opacity 0.3s'
    },
    switchInput: {
      opacity: 0,
      width: 0,
      height: 0,
    },
    slider: (checked, isLoading) => ({
      position: 'absolute',
      cursor: isLoading ? 'wait' : 'pointer',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: checked ? '#22c55e' : '#cbd5e1',
      transition: '.4s',
      borderRadius: '34px',
      opacity: isLoading ? 0.6 : 1
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

  const fetchVisaoGeral = useCallback(async () => {
    const t = Date.now();

    const promises = (estoqueConfig || []).map(async (item) => {
      try {
        const res = await axios.get(`${API_URL}/analise/${item.id}?t=${t}`);
        const analise = res.data?.analise_risco ?? {};
        const tele = res.data?.telemetria ?? {};
        const ultimoDado = tele.historico && tele.historico.length > 0 ? tele.historico[0] : {};
        const modoBackendAtivo = ultimoDado.modo === "MANUTENCAO_ONLINE"; 
        
        return {
          id: item.id,
          data: {
            score: analise.health_score ?? null,
            status_operacional: analise.status_operacional ?? null,
            temp: typeof tele.temperatura_atual === 'number' ? tele.temperatura_atual : null,
            violacao: tele?.violacao ?? false,
            tampa_aberta: tele?.tampa_aberta ?? false,
            historico: tele?.historico ?? [],
            erro: false,
            modoBackend: modoBackendAtivo 
          }
        };
      } catch (err) {
        return {
          id: item.id,
          data: {
            score: null, status_operacional: null, temp: null, violacao: false, tampa_aberta: false, historico: [], erro: true,
            modoBackend: false
          }
        };
      }
    });

    const results = await Promise.all(promises);

    setResumoEstoque(prevState => {
      const newState = { ...prevState };
      
      results.forEach(({ id, data }) => {
        const isLoading = loadingStatesRef.current[id];
        const statusManutencaoFinal = isLoading 
            ? (prevState[id]?.emManutencao ?? false) 
            : data.modoBackend; 

        newState[id] = {
          ...data,
          emManutencao: statusManutencaoFinal
        };
      });
      
      return newState;
    });
  }, [estoqueConfig]);

  const toggleManutencao = async (boxId, estadoAtualOn, e) => {
    e.stopPropagation();

    if (loadingStates[boxId]) return;

    const novoStatus = !estadoAtualOn;
    const comando = novoStatus ? "MANUTENCAO_ON" : "MANUTENCAO_OFF";

    setLoadingStates(prev => ({ ...prev, [boxId]: true }));

    setResumoEstoque(prev => ({
      ...prev,
      [boxId]: {
        ...prev[boxId],
        emManutencao: novoStatus
      }
    }));

    try {
      await axios.post(`${API_URL}/controle/${boxId}`, { comando });
      console.log(`Comando ${comando} enviado para ${boxId}`);
 
      setTimeout(() => {
         setLoadingStates(prev => {
             const copy = { ...prev };
             delete copy[boxId];
             return copy;
         });
      }, 1000);

    } catch (error) {
      console.error("Erro ao enviar comando", error);
      alert("Falha na conexão com a caixa.");
      
      setResumoEstoque(prev => ({
        ...prev,
        [boxId]: { ...prev[boxId], emManutencao: estadoAtualOn }
      }));
      
      setLoadingStates(prev => {
         const copy = { ...prev };
         delete copy[boxId];
         return copy;
      });
    }
  };

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
          const isLoadingSwitch = loadingStates[item.id];
          
          let corStatus = '#cbd5e1'; let statusLabel = 'AGUARDANDO'; let classeAnimacao = 'status-offline'; let icone = '❄️';
          const score = dados ? dados.score : null;

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
                  border: isManutencao ? '1px solid #22c55e' : '1px solid transparent',
                  transition: 'border 0.3s'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#334155' }}>
                        CONEXÃO TEMPO REAL
                    </span>
                    <span style={{ fontSize: '0.65rem', color: isManutencao ? '#22c55e' : '#94a3b8' }}>
                        {isLoadingSwitch ? 'Processando...' : (isManutencao ? 'Ativo (Alto consumo)' : 'Desativado (Modo Eco)')}
                    </span>
                </div>
                
                <div 
                    style={{...styles.switchContainer, opacity: isOfflineOrAguardando ? 0.5 : 1}} 
                    onClick={(e) => !isOfflineOrAguardando && toggleManutencao(item.id, isManutencao, e)}
                >
                    <div style={styles.slider(isManutencao, isLoadingSwitch)}></div>
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