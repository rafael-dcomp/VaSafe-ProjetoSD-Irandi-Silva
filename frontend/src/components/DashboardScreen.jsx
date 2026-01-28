import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API_URL = "http://98.90.117.5:8000";

export default function DashboardScreen({ estoqueConfig = [], onSelectCaixa }) {
  const [resumoEstoque, setResumoEstoque] = useState({});
  const [loadingStates, setLoadingStates] = useState({});
  
  // Ref para controlar quais caixas estão sendo alteradas manualmente pelo usuário.
  // Isso impede que o 'setInterval' sobrescreva o botão enquanto a ação processa.
  const actionPendingRef = useRef({});

  const styles = {
    btnGroup: {
      display: 'flex',
      gap: '8px',
      marginTop: '4px'
    },
    btnAction: (tipo, isActive, disabled) => {
      const colorGreen = '#22c55e';
      const colorRed = '#ef4444';
      const colorGray = '#94a3b8';

      let baseColor = tipo === 'ON' ? colorGreen : colorRed;
      
      // Estado Desabilitado (Visual)
      if (disabled && !isActive) return {
        flex: 1,
        padding: '6px 0',
        borderRadius: '6px',
        border: `1px solid ${colorGray}`,
        backgroundColor: 'transparent',
        color: colorGray,
        cursor: 'not-allowed',
        opacity: 0.5,
        fontSize: '0.7rem',
        fontWeight: 'bold'
      };

      // Estado Ativo (Botão Selecionado)
      if (isActive) {
        return {
          flex: 1,
          padding: '6px 0',
          borderRadius: '6px',
          border: `1px solid ${baseColor}`,
          backgroundColor: baseColor,
          color: 'white',
          cursor: 'default', 
          fontSize: '0.7rem',
          fontWeight: 'bold',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        };
      }

      // Estado Normal (Botão clicável mas não selecionado)
      return {
        flex: 1,
        padding: '6px 0',
        borderRadius: '6px',
        border: `1px solid ${baseColor}`,
        backgroundColor: 'white',
        color: baseColor,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontSize: '0.7rem',
        fontWeight: 'bold',
        transition: 'all 0.2s'
      };
    }
  };

  const fetchVisaoGeral = useCallback(async () => {
    const t = Date.now();

    const promises = (estoqueConfig || []).map(async (item) => {
      try {
        const res = await axios.get(`${API_URL}/analise/${item.id}?t=${t}`);
        const analise = res.data?.analise_risco ?? {};
        const tele = res.data?.telemetria ?? {};
        const ultimoDado = tele.historico && tele.historico.length > 0 ? tele.historico[0] : {};
        
        // Verifica se o modo manutenção está ativo no backend
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
        // AQUI ESTÁ A CORREÇÃO:
        // Se o usuário clicou no botão recentemente (actionPendingRef é true),
        // ignoramos o que vem do servidor sobre o modo manutenção e mantemos o que está na tela.
        // Isso evita que o botão "pisque" ou volte ao estado anterior enquanto processa.
        const isUserInteracting = actionPendingRef.current[id];
        
        const statusManutencaoFinal = isUserInteracting 
            ? (prevState[id]?.emManutencao ?? false) // Mantém estado local
            : data.modoBackend; // Usa estado do servidor

        newState[id] = {
          ...data,
          emManutencao: statusManutencaoFinal
        };
      });
      
      return newState;
    });
  }, [estoqueConfig]);

  const enviarComandoManutencao = async (boxId, comandoTipo, e) => {
    e.stopPropagation();

    // Evita clique duplo
    if (loadingStates[boxId]) return;

    const comando = comandoTipo === 'ON' ? "MANUTENCAO_ON" : "MANUTENCAO_OFF";
    const novoStatusBooleano = comandoTipo === 'ON';

    // 1. Bloqueia atualizações do servidor para esta caixa
    actionPendingRef.current[boxId] = true;
    setLoadingStates(prev => ({ ...prev, [boxId]: true }));

    // 2. Atualização Otimista (Muda a cor do botão imediatamente)
    setResumoEstoque(prev => ({
      ...prev,
      [boxId]: {
        ...prev[boxId],
        emManutencao: novoStatusBooleano
      }
    }));

    try {
      await axios.post(`${API_URL}/controle/${boxId}`, { comando });
      console.log(`Comando ${comando} enviado para ${boxId}`);
 
      // 3. Aguarda um tempo antes de liberar a atualização do servidor.
      // Isso é crucial para o "OFF", pois o dispositivo vai desligar o WiFi.
      // Se liberarmos muito rápido, o servidor pode ainda achar que está ON.
      setTimeout(() => {
         delete actionPendingRef.current[boxId]; // Libera para receber dados do servidor
         setLoadingStates(prev => {
             const copy = { ...prev };
             delete copy[boxId];
             return copy;
         });
      }, 2500); // 2.5 segundos de "trava" visual

    } catch (error) {
      console.error("Erro ao enviar comando", error);
      alert("Falha ao comunicar com o servidor.");
      
      // Reverte em caso de erro
      delete actionPendingRef.current[boxId];
      setResumoEstoque(prev => ({
        ...prev,
        [boxId]: { ...prev[boxId], emManutencao: !novoStatusBooleano }
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
    const id = setInterval(fetchVisaoGeral, 3000); // Atualiza a cada 3 segundos
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
          // O estado visual do botão depende do valor local otimista
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
                  border: isManutencao ? '1px solid #22c55e' : '1px solid transparent',
                  transition: 'border 0.3s'
              }}>
                <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#334155' }}>
                        CONEXÃO TEMPO REAL
                    </span>
                    <span style={{ fontSize: '0.65rem', color: isManutencao ? '#22c55e' : '#94a3b8' }}>
                        {isLoadingSwitch ? 'Processando...' : (isManutencao ? 'Ativo' : 'Inativo')}
                    </span>
                </div>
                
                <div style={styles.btnGroup}>
                    {/* Botão ATIVAR */}
                    <button 
                        style={styles.btnAction('ON', isManutencao, isOfflineOrAguardando || isLoadingSwitch)}
                        onClick={(e) => enviarComandoManutencao(item.id, 'ON', e)}
                        disabled={isManutencao || isOfflineOrAguardando || isLoadingSwitch}
                    >
                        ATIVAR
                    </button>
                    
                    {/* Botão DESATIVAR */}
                    <button 
                        style={styles.btnAction('OFF', !isManutencao, isOfflineOrAguardando || isLoadingSwitch)}
                        onClick={(e) => enviarComandoManutencao(item.id, 'OFF', e)}
                        // Só pode desativar se estiver em manutenção E não estiver carregando
                        disabled={!isManutencao || isLoadingSwitch}
                    >
                        DESATIVAR
                    </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}