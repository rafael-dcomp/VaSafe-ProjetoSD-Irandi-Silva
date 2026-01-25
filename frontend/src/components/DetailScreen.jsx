import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import StatusBadge from './StatusBadge';
import StatCard from './StatCard';

const API_URL = "http://98.88.32.2:8000";

export default function DetailScreen({ caixaId, caixaNome, onVoltar }) {
  const [analise, setAnalise] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const fetchDetalhe = useCallback(async () => {
    try {
      const timestamp = Date.now();
      const res = await axios.get(`${API_URL}/analise/${caixaId}?t=${timestamp}`);
      setAnalise(res.data);
      setLastUpdate(new Date());
    } catch (e) {
      // Não sobrescreve estado anterior em caso de erro — mantém último estado exibido
      console.error("Erro ao detalhar caixa:", e);
    }
  }, [caixaId]);

  useEffect(() => {
    fetchDetalhe();
    const interval = setInterval(fetchDetalhe, 3000);
    return () => clearInterval(interval);
  }, [fetchDetalhe]);

  const handleSyncClick = async () => {
    setSyncing(true);
    try {
      await fetchDetalhe();
    } finally {
      // Pequeno delay visual para melhor UX
      setTimeout(() => setSyncing(false), 400);
    }
  };

  if (!analise) {
    return (
      <div className="detail-wrapper">
        <div className="panel" style={{ textAlign: 'center' }}>
          <h2>⌛</h2>
          <p className="update-badge">Conectando ao Digital Twin...</p>
        </div>
      </div>
    );
  }

  // Fallbacks seguros
  const telemetria = analise.telemetria ?? {};
  const analise_risco = analise.analise_risco ?? {};

  const isViolado = Boolean(telemetria.violacao);
  const isAberta = Boolean(telemetria.tampa_aberta);
  const isOffline = analise_risco.health_score === null
    || analise_risco.status_operacional === 'OFFLINE'
    || analise_risco.status_operacional === 'AGUARDANDO';

  // Prepara dados do gráfico (ordena e formata)
  const historicoRaw = Array.isArray(telemetria.historico) ? telemetria.historico.slice() : [];
  const chartData = historicoRaw
    .map(d => ({
      ...d,
      temperatura: typeof d.temperatura === 'number' ? d.temperatura :
                   (d.temperatura ? Number(d.temperatura) : null),
      tampa_aberta: d.tampa_aberta ? 1 : 0,
      timeObj: d.time ? new Date(d.time) : null
    }))
    .filter(d => d.timeObj)
    .sort((a, b) => a.timeObj - b.timeObj)
    .map(d => ({
      ...d,
      timeLabel: d.timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }));

  const displayTemp = (v) => (typeof v === 'number' && !Number.isNaN(v) ? `${v.toFixed(1)}°C` : '--');
  const displayBattery = (b) => (typeof b === 'number' && !Number.isNaN(b) ? `${b}%` : '--');

  // Passa cores dinâmicas para StatCard (eles devem aplicar essas cores)
  const batteryColor = (b) => (typeof b === 'number' ? (b < 20 ? 'var(--color-danger)' : 'var(--text-main)') : 'var(--text-muted)');

  return (
    <div className={`detail-wrapper ${isViolado ? 'alert-violation' : (isAberta ? 'alert-open' : '')}`}>
      <div className="controls-area">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn-voltar" onClick={onVoltar} aria-label="Voltar">
            ⬅ Voltar
          </button>

          <div>
            <div style={{ fontWeight: 700 }}>{caixaNome}</div>
            <div className="update-badge">
              {lastUpdate ? `Última sincronização: ${lastUpdate.toLocaleTimeString()}` : 'Ainda sem atualizações'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn-voltar"
            onClick={handleSyncClick}
            aria-label="Sincronizar agora"
            disabled={syncing}
            title="Forçar sincronização"
          >
            {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
        </div>
      </div>

      <div className="header-detail">
        <h2 style={{ color: isViolado ? 'var(--color-danger)' : (isOffline ? 'var(--text-muted)' : 'var(--text-main)') }}>
          {isOffline ? `OFFLINE — ${caixaNome}` : (isViolado ? '⚠️ CAIXA VIOLADA' : `Detalhes — ${caixaNome}`)}
        </h2>

        {isAberta && !isViolado && !isOffline && <span className="tag-aberta">TAMPA ABERTA</span>}

        <div style={{ marginLeft: 'auto' }}>
          <StatusBadge
            status={analise_risco.status_operacional ?? (isOffline ? 'OFFLINE' : '—')}
            cor={analise_risco.indicador_led ?? (isOffline ? '#cbd5e1' : '#22c55e')}
            recomendacao={analise_risco.recomendacao ?? ''}
          />
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          titulo="Saúde da Caixa"
          valor={isOffline ? '--' : (analise_risco.health_score ?? '--')}
          unidade={isOffline ? '' : '%'}
          cor={(analise_risco.health_score ?? 100) < 60 ? 'var(--color-danger)' : 'var(--color-success)'}
          helpText={analise_risco.recomendacao}
        />

        <StatCard
          titulo="Temperatura Atual"
          valor={displayTemp(telemetria.temperatura_atual)}
          unidade=""
          cor="var(--primary)"
          helpText={isOffline ? 'Sem dados' : 'Temperatura medida pelo sensor'}
        />

        <StatCard
          titulo="Segurança"
          valor={isViolado ? 'CRÍTICO' : (isAberta ? 'ALERTA' : 'OK')}
          unidade=""
          cor={isViolado ? 'var(--color-danger)' : (isAberta ? 'var(--color-warning)' : 'var(--color-success)')}
          helpText={isViolado ? 'Violação detectada' : (isAberta ? 'Tampa aberta' : 'Sem problemas')}
        />

        <StatCard
          titulo="Bateria"
          valor={typeof telemetria.bateria === 'undefined' ? '--' : displayBattery(telemetria.bateria)}
          unidade=""
          cor={batteryColor(telemetria.bateria)}
          helpText={typeof telemetria.bateria === 'undefined' ? 'Fonte externa (alimentado via USB)' : 'Nível de bateria'}
        />
      </div>

      <div className="panel">
        <h3>Histórico em Tempo Real</h3>
        <div className="chart-container">
          {chartData.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Sem histórico disponível
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData.map(d => ({ ...d, time: d.timeLabel }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                <YAxis domain={['auto', 'auto']} unit="°C" tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 8 }} />
                <Legend verticalAlign="top" height={36} />
                <Line
                  type="monotone"
                  dataKey="temperatura"
                  stroke={isViolado ? "var(--color-dark)" : "var(--primary)"}
                  strokeWidth={3}
                  dot={false}
                  name="Temperatura (°C)"
                />
                <Line
                  type="step"
                  dataKey="tampa_aberta"
                  stroke="var(--color-warning)"
                  strokeWidth={2}
                  dot={false}
                  name="Tampa Aberta (0/1)"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
