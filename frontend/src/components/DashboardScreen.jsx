import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'

const API_URL = "http://98.90.117.5:8000"
const STORAGE_KEY = 'lote_pending_actions'

export default function DashboardScreen({ estoqueConfig = [], onSelectCaixa }) {
  const [resumoEstoque, setResumoEstoque] = useState({})

  // pendingActions armazena: { [id]: { target: boolean, timestamp: number } }
  const [pendingActions, setPendingActions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : {}
    } catch (e) {
      return {}
    }
  })

  // Salva persistência no LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingActions))
  }, [pendingActions])

  const styles = {
    btnGroup: {
      display: 'flex',
      gap: '8px',
      marginTop: '4px'
    },
    btnAction: (tipo, isActive, disabled, isSelfProcessing) => {
      const colorGreen = '#22c55e'
      const colorRed = '#ef4444'
      const colorGray = '#94a3b8'
      let baseColor = tipo === 'ON' ? colorGreen : colorRed

      // Se ESTE botão específico está processando
      if (isSelfProcessing) {
         return {
          flex: 1,
          padding: '6px 0',
          borderRadius: '6px',
          border: `1px solid ${baseColor}`,
          backgroundColor: isActive ? baseColor : 'transparent',
          color: isActive ? 'white' : baseColor,
          cursor: 'wait',
          opacity: 0.7,
          fontSize: '0.7rem',
          fontWeight: 'bold',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }
      }

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
      }
      
      if (isActive) return {
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
      }
      
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
      }
    }
  }

  const normalizeModo = (v) => {
    if (!v || typeof v !== 'string') return null
    const s = v.trim().toUpperCase()
    if (s.includes('MANUTENCAO')) {
      if (s.includes('ON') || s.includes('ONLINE')) return true
      if (s.includes('OFF')) return false
    }
    if (s.includes('ON')) return true
    if (s.includes('OFF')) return false
    return null
  }

  const fetchVisaoGeral = useCallback(async () => {
    const t = Date.now()
    
    // Limpeza de ações pendentes velhas (> 45s)
    setPendingActions(prev => {
      const now = Date.now()
      let changed = false
      const newPending = { ...prev }
      Object.keys(newPending).forEach(key => {
        if (now - newPending[key].timestamp > 45000) {
          delete newPending[key]
          changed = true
        }
      })
      return changed ? newPending : prev
    })

    const promises = (estoqueConfig || []).map(async (item) => {
      try {
        const res = await axios.get(`${API_URL}/analise/${item.id}?t=${t}`)
        const analise = res.data?.analise_risco ?? {}
        const tele = res.data?.telemetria ?? {}
        const ultimoDado = Array.isArray(tele.historico) && tele.historico.length > 0 ? tele.historico[0] : {}
        const modoFromServer = normalizeModo(ultimoDado.modo ?? tele.modo ?? '')
        
        return {
          id: item.id,
          data: {
            score: analise.health_score ?? null,
            status_operacional: analise.status_operacional ?? null,
            temp: typeof tele.temperatura_atual === 'number' ? tele.temperatura_atual : (typeof tele.temperatura === 'number' ? tele.temperatura : null),
            violacao: tele?.violacao ?? false,
            tampa_aberta: tele?.tampa_aberta ?? tele?.aberta ?? false,
            historico: Array.isArray(tele?.historico) ? tele.historico : [],
            erro: false,
            modoBackend: modoFromServer
          }
        }
      } catch (err) {
        return {
          id: item.id,
          data: {
            score: null,
            status_operacional: null,
            temp: null,
            violacao: false,
            tampa_aberta: false,
            historico: [],
            erro: true,
            modoBackend: false
          }
        }
      }
    })

    const results = await Promise.all(promises)

    setResumoEstoque(prevState => {
      const newState = { ...prevState }
      let actionsToClear = []

      results.forEach(({ id, data }) => {
        const pending = pendingActions[id]

        if (pending) {
          // Se o servidor já obedeceu o comando (Sincronizado)
          if (data.modoBackend === pending.target) {
             actionsToClear.push(id)
             newState[id] = { ...data, emManutencao: data.modoBackend, pendingTarget: null }
          } else {
             // Ainda não obedeceu, mantemos a UI otimista mas "Processando"
             newState[id] = { 
               ...data, 
               emManutencao: pending.target, 
               pendingTarget: pending.target // Marca qual é o alvo pendente
             }
          }
        } else {
          newState[id] = { ...data, emManutencao: data.modoBackend, pendingTarget: null }
        }
      })

      if (actionsToClear.length > 0) {
        setTimeout(() => {
          setPendingActions(current => {
            const copy = { ...current }
            actionsToClear.forEach(pid => delete copy[pid])
            return copy
          })
        }, 0)
      }

      return newState
    })
  }, [estoqueConfig, pendingActions])

  const postWithRetries = async (url, body, attempts = 3) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await axios.post(url, body, { timeout: 5000 })
        return res
      } catch (e) {
        if (i === attempts - 1) throw e
        await new Promise(r => setTimeout(r, 500))
      }
    }
  }

  const enviarComandoManutencao = async (boxId, comandoTipo, e) => {
    if (e && e.stopPropagation) e.stopPropagation()
    
    // NÃO BLOQUEIAMOS mais se já estiver processando.
    // Permitimos a troca de comando.

    const comando = comandoTipo === 'ON' ? "MANUTENCAO_ON" : "MANUTENCAO_OFF"
    const targetStatus = comandoTipo === 'ON'

    // Atualiza a pendência (se já existia uma contrária, sobrescreve)
    setPendingActions(prev => ({
      ...prev,
      [boxId]: { target: targetStatus, timestamp: Date.now() }
    }))

    // Atualiza UI imediata
    setResumoEstoque(prev => ({ 
        ...prev, 
        [boxId]: { ...prev[boxId], emManutencao: targetStatus, pendingTarget: targetStatus } 
    }))

    try {
      await postWithRetries(`${API_URL}/controle/${boxId}`, { comando }, 3)
    } catch (error) {
      // Se falhar rede, removemos pendência
      setPendingActions(prev => {
        const copy = { ...prev }
        delete copy[boxId]
        return copy
      })
      window.alert('Falha ao enviar comando. Verifique a conexão.')
    }
  }

  useEffect(() => {
    fetchVisaoGeral()
    const id = setInterval(fetchVisaoGeral, 2000)
    return () => clearInterval(id)
  }, [fetchVisaoGeral])

  const formatTemp = (t) => (typeof t === 'number' && !Number.isNaN(t)) ? `${t.toFixed(1)}°C` : '--'

  return (
    <div className="menu-container">
      <h2 style={{ color: '#1e293b', marginBottom: 20 }}>Monitoramento de Lotes</h2>
      <div className="caixa-grid">
        {(estoqueConfig || []).map((item) => {
          const dados = resumoEstoque[item.id]
          
          // Lógica de Processamento refinada:
          // pendingTarget é true (ON), false (OFF) ou null (Nenhum)
          const pendingTarget = dados?.pendingTarget
          const isProcessingAny = pendingTarget !== undefined && pendingTarget !== null
          
          let corStatus = '#cbd5e1'
          let statusLabel = 'AGUARDANDO'
          let classeAnimacao = 'status-offline'
          let icone = '❄️'
          const score = dados ? dados.score : null

          if (!dados || dados.erro || dados.status_operacional === 'OFFLINE') {
            corStatus = '#94a3b8'
            statusLabel = 'OFFLINE'
            classeAnimacao = 'status-offline'
            icone = '📡'
          } else if (dados.violacao || dados.tampa_aberta) {
            corStatus = '#ef4444'
            statusLabel = 'VIOLAÇÃO'
            classeAnimacao = 'status-danger'
            icone = '🚨'
          } else if (dados.temp !== null && (dados.temp < 2.0 || dados.temp > 8.0)) {
            corStatus = '#eab308'
            statusLabel = 'ALERTA'
            classeAnimacao = 'status-warning'
            icone = '⚠️'
          } else {
            corStatus = '#22c55e'
            statusLabel = score !== null ? `${score}% Saúde` : 'ESTÁVEL'
            classeAnimacao = 'status-ok'
            icone = '❄️'
          }

          const isOfflineOrAguardando = dados?.erro === true || dados?.status_operacional === 'AGUARDANDO' || dados?.status_operacional === 'OFFLINE'
          const isManutencao = dados?.emManutencao || false

          // --- LÓGICA DOS BOTÕES ---
          
          // Botão ON:
          // - Processando (girando) se o alvo pendente for TRUE
          // - Desabilitado se: Estiver offline OU (já estiver ON E não estiver pendente troca)
          const isProcessingOn = pendingTarget === true
          const disabledOn = isOfflineOrAguardando || (isManutencao && !isProcessingAny) || isProcessingOn

          // Botão OFF:
          // - Processando (girando) se o alvo pendente for FALSE
          // - Desabilitado se: (!estiver ON E não estiver pendente troca)
          const isProcessingOff = pendingTarget === false
          const disabledOff = (!isManutencao && !isProcessingAny) || isProcessingOff

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
                    <span style={{ fontSize: '0.65rem', color: isProcessingAny ? '#f59e0b' : (isManutencao ? '#22c55e' : '#94a3b8'), fontWeight: isProcessingAny ? 'bold' : 'normal' }}>
                        {isProcessingAny ? 'Sincronizando com ESP...' : (isManutencao ? 'Ativo' : 'Inativo')}
                    </span>
                </div>
                <div style={styles.btnGroup}>
                    <button
                        style={styles.btnAction('ON', isManutencao, disabledOn, isProcessingOn)}
                        onClick={(e) => enviarComandoManutencao(item.id, 'ON', e)}
                        disabled={disabledOn}
                    >
                        {isProcessingOn ? '...' : 'ATIVAR'}
                    </button>
                    <button
                        style={styles.btnAction('OFF', !isManutencao, disabledOff, isProcessingOff)}
                        onClick={(e) => enviarComandoManutencao(item.id, 'OFF', e)}
                        disabled={disabledOff}
                    >
                        {isProcessingOff ? '...' : 'DESATIVAR'}
                    </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}