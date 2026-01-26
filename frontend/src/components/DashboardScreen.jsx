import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = "http://98.90.117.5:8000";

const getStatusColor = (score) => {
  if (score === undefined || score === null) return '#cbd5e1'; 
  if (score === 0) return '#000000'; 
  if (score >= 90) return '#22c55e'; 
  if (score >= 60) return '#eab308'; 
  return '#ef4444'; 
};

export default function DashboardScreen({ estoqueConfig = [], onSelectCaixa }) {
  const [resumoEstoque, setResumoEstoque] = useState({});

  const fetchVisaoGeral = useCallback(async () => {
    const t = Date.now();
    const novos = {};

    await Promise.all(
      (estoqueConfig || []).map(async (item) => {
        try {
          const res = await axios.get(`${API_URL}/analise/${item.id}?t=${t}`);

          const analise = res.data?.analise_risco ?? {};
          const tele = res.data?.telemetria ?? {};

          novos[item.id] = {
            score: analise.health_score ?? null,
            status_operacional: analise.status_operacional ?? null,
            temp: typeof tele.temperatura_atual === 'number' ? tele.temperatura_atual : null,
            violacao: tele?.violacao ?? false,
            tampa_aberta: tele?.tampa_aberta ?? false,
            historico: tele?.historico ?? [],
            erro: false
          };
        } catch (err) {
          novos[item.id] = {
            score: null,
            status_operacional: null,
            temp: null,
            violacao: false,
            tampa_aberta: false,
            historico: [],
            erro: true
          };
        }
      })
    );

    setResumoEstoque(novos);
  }, [estoqueConfig]);

  useEffect(() => {
    fetchVisaoGeral();
    const id = setInterval(fetchVisaoGeral, 3000);
    return () => clearInterval(id);
  }, [fetchVisaoGeral]);

  const renderStatusLabel = (score, status, isErro) => {
    if (isErro) return 'OFFLINE';
    if (status) {
      return status;
    }
    if (score === null || score === undefined) return 'AGUARDANDO';
    if (score === 0) return 'FRAUDE';
    return `${score}% Saúde`;
  };

  const formatTemp = (t) =>
    (typeof t === 'number' && !Number.isNaN(t)) ? `${t.toFixed(1)}°C` : '--';

  return (
    <div className="menu-container">
      <h2 style={{ color: '#1e293b', marginBottom: 20 }}>📦 Visão Geral das Caixas</h2>

      <div className="caixa-grid">
        {(estoqueConfig || []).map((item) => {
          const dados = resumoEstoque[item.id];
          const score = dados ? dados.score : null;
          const corStatus = getStatusColor(score);
          const isOfflineOrAguardando = dados?.erro === true
            || dados?.status_operacional === 'AGUARDANDO'
            || dados?.status_operacional === 'OFFLINE';

          return (
            <div
              key={item.id}
              className="caixa-card"
              onClick={() => onSelectCaixa(item.id)}
              style={{ borderTop: `6px solid ${corStatus}` }}
            >
              <div className="caixa-header">
                <div className="icon-bg" style={{ backgroundColor: corStatus + '20' }}>
                  <span style={{ fontSize: 20 }}>{score === 0 ? '⚠️' : '❄️'}</span>
                </div>

                <span className="status-pill" style={{ backgroundColor: corStatus, color: '#fff' }}>
                  {renderStatusLabel(score, dados?.status_operacional, dados?.erro)}
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
                  <small>Saúde</small>
                  <strong style={{ color: corStatus }}>
                    {!isOfflineOrAguardando && score !== null
                      ? `${score}%`
                      : '--'}
                  </strong>
                </div>

                <div className="stat-item">
                  <small>ID</small>
                  <span style={{ fontSize: '0.8rem' }}>{item.id}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}