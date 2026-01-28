import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, ComposedChart
} from 'recharts';
import StatusBadge from './StatusBadge';
import StatCard from './StatCard';

import '../App.css'; 

const API_URL = "http://98.90.117.5:8000";

const THEME = {
  primary: '#3b82f6',
  danger: '#ef4444',
  warning: '#f59e0b',
  success: '#22c55e',
  dark: '#1e293b',
  grid: '#f1f5f9',
  textMuted: '#94a3b8',
  invalid: '#334155' 
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map((entry, index) => (
          <div key={index} className="tooltip-item">
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: entry.color }} />
            <span>
              {entry.name}: <strong>{entry.value} {entry.unit}</strong>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function DetailScreen({ caixaId, caixaNome, onVoltar }) {
  const [analise, setAnalise] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchDetalhe = useCallback(async () => {
    try {
      const timestamp = Date.now();
      const res = await axios.get(`${API_URL}/analise/${caixaId}?t=${timestamp}`);
      setAnalise(res.data);
      setLastUpdate(new Date());
    } catch (e) {
      console.error("Erro ao detalhar caixa:", e);
    }
  }, [caixaId]);

  useEffect(() => {
    fetchDetalhe();
    const interval = setInterval(fetchDetalhe, 3000);
    return () => clearInterval(interval);
  }, [fetchDetalhe]);

  if (!analise) {
    return (
      <div className="detail-wrapper loading-state">
        <div className="spinner"></div>
        <p>Conectando ao Digital Twin...</p>
      </div>
    );
  }

  const telemetria = analise.telemetria ?? {};
  const analise_risco = analise.analise_risco ?? {};
  const healthScore = analise_risco.health_score;
  const isOffline = healthScore === null || analise_risco.status_operacional === 'OFFLINE';
  const isLoteInvalido = !isOffline && healthScore === 0;
  const isViolado = !isOffline && !isLoteInvalido && Boolean(telemetria.violacao);
  const isAberta = Boolean(telemetria.tampa_aberta);
  
  const historicoRaw = Array.isArray(telemetria.historico) ? telemetria.historico.slice() : [];
  
  // Lógica para detectar o modo (Economia vs Tempo Real)
  const modoRaw = telemetria.modo || (historicoRaw.length > 0 ? historicoRaw[0].modo : '');
  const isModoEconomia = typeof modoRaw === 'string' && modoRaw.toUpperCase().includes('MANUTENCAO_ON');

  const chartData = historicoRaw
    .map(d => ({
      ...d,
      temperatura: d.temperatura ? Number(d.temperatura) : null,
      tampa_aberta: d.tampa_aberta ? 1 : 0, 
      timeObj: d.time ? new Date(d.time) : null
    }))
    .filter(d => d.timeObj)
    .sort((a, b) => a.timeObj - b.timeObj)
    .map(d => ({
      ...d,
      timeLabel: d.timeObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }));

  const displayTemp = (v) => (typeof v === 'number' ? `${v.toFixed(1)}°C` : '--');

  const getHeaderColor = () => {
    if (isOffline) return THEME.textMuted;
    if (isLoteInvalido) return THEME.invalid;
    if (isViolado) return THEME.danger;
    if (isAberta) return THEME.warning;
    return THEME.success;
  };

  const getHeaderText = () => {
    if (isOffline) return 'OFFLINE';
    if (isLoteInvalido) return 'LOTE INVÁLIDO / PERDA TOTAL';
    if (isViolado) return 'VIOLAÇÃO DETECTADA';
    return 'Monitoramento Ativo';
  };

  return (
    <div className="detail-wrapper fadeIn">
      <div className="controls-area">
        <div className="header-left">
          <button className="btn-voltar" onClick={onVoltar}>
            <span style={{ fontSize: '1.2rem' }}>‹</span> Voltar
          </button>
          
          <div className="header-info">
            <h1>{caixaNome}</h1>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', marginBottom: '4px' }}>
              {/* Badge de Modo de Operação */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: '700',
                backgroundColor: isModoEconomia ? '#fffbeb' : '#ecfdf5',
                color: isModoEconomia ? '#b45309' : '#047857',
                border: `1px solid ${isModoEconomia ? '#fcd34d' : '#6ee7b7'}`
              }}>
                <span>{isModoEconomia ? '⏸️' : '⚡'}</span>
                {isModoEconomia ? 'MODO ECONOMIA' : 'TEMPO REAL'}
              </div>

              <span className="last-update">
                {lastUpdate ? `Atualizado às ${lastUpdate.toLocaleTimeString()}` : '...'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="status-banner" style={{ borderLeft: `6px solid ${getHeaderColor()}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <h2 style={{ color: getHeaderColor(), margin: 0 }}>
            {getHeaderText()}
          </h2>
          {isAberta && !isViolado && !isLoteInvalido && !isOffline && (
            <span className="tag-warning">TAMPA ABERTA</span>
          )}
        </div>
        
        <StatusBadge 
          status={isLoteInvalido ? 'CRÍTICO' : (analise_risco.status_operacional ?? '---')}
          cor={analise_risco.indicador_led ?? '#ccc'}
          recomendacao={isLoteInvalido ? "Descartar lote imediatamente." : analise_risco.recomendacao}
        />
      </div>

      <div className="stats-grid">
        <StatCard
          titulo="Saúde"
          valor={healthScore ?? '--'}
          unidade={isOffline ? '' : '%'}
          cor={isLoteInvalido ? THEME.invalid : ((healthScore ?? 100) < 60 ? THEME.danger : THEME.success)}
          icon="❤️"
        />
        <StatCard
          titulo="Temperatura"
          valor={displayTemp(telemetria.temperatura_atual)}
          unidade=""
          cor={THEME.primary}
          icon="❄️"
        />
        <StatCard
          titulo="Segurança"
          valor={isLoteInvalido ? 'INVÁLIDO' : (isViolado ? 'VIOLADO' : (isAberta ? 'ALERTA' : 'OK'))}
          unidade=""
          cor={isLoteInvalido ? THEME.invalid : (isViolado ? THEME.danger : (isAberta ? THEME.warning : THEME.success))}
          icon="🔒"
        />
      </div>

      <div className="chart-panel">
        <div className="chart-header">
          <h3>Histórico Recente</h3>
          <p>Temperatura e Eventos de Abertura</p>
        </div>

        <div className="chart-container">
          {chartData.length === 0 ? (
            <div className="empty-state">Sem dados de histórico disponíveis</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={THEME.primary} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={THEME.primary} stopOpacity={0}/>
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                
                <XAxis 
                  dataKey="timeLabel" 
                  stroke="#94a3b8" 
                  fontSize={12} 
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40} 
                  dy={10}
                />

                <YAxis 
                  yAxisId="left"
                  stroke="#94a3b8" 
                  fontSize={12} 
                  tickLine={false}
                  axisLine={false}
                  unit="°C"
                  domain={['auto', 'auto']}
                />

                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 1]}
                  ticks={[0, 1]}
                  hide={true} 
                />

                <Tooltip content={<CustomTooltip />} />
                
                <Legend 
                  verticalAlign="top" 
                  align="right" 
                  iconType="circle" 
                  wrapperStyle={{ paddingBottom: '20px' }}
                />

                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="temperatura"
                  name="Temperatura"
                  stroke={THEME.primary}
                  fillOpacity={1}
                  fill="url(#colorTemp)"
                  strokeWidth={3}
                  unit="°C"
                />

                <Line
                  yAxisId="right"
                  type="stepAfter"
                  dataKey="tampa_aberta"
                  name="Tampa Aberta"
                  stroke={THEME.warning}
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="5 5"
                  unit=""
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}