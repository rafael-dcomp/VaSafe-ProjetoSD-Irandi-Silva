import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = "http://98.90.117.5:8000";

const getStatusColor = (score) => {
  if (score === undefined || score === null) return '#cbd5e1'; // Cinza (Aguardando/sem dado)
  if (score === 0) return '#000000'; // Preto (Fraude/Violação)
  if (score >= 90) return '#22c55e'; // Verde (Ótimo)
  if (score >= 60) return '#eab308'; // Amarelo (Atenção)
  return '#ef4444'; // Laranja/Vermelho (Risco)
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
            bateria: (tele.hasOwnProperty('bateria') ? tele.bateria : undefined), // pode ser undefined
            violacao: tele?.violacao ?? false,
            tampa_aberta: tele?.tampa_aberta ?? false,
            historico: tele?.historico ?? [],
            erro: false
          };
        } catch (err) {
          // falha de rede / timeout: marca erro
          novos[item.id] = {
            score: null,
            status_operacional: null,
            temp: null,
            bateria: undefined,
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
      // Usa explicitamente o status vindo do backend (ex: AGUARDANDO, FRAUDE, APROVADO...)
      // Se for AGUARDANDO, mostra isso em vez de 'OFFLINE'
      return status;
    }
    if (score === null || score === undefined) return 'AGUARDANDO';
    if (score === 0) return 'FRAUDE';
    return `${score}% Saúde`;
  };

  const formatTemp = (t) =>
    (typeof t === 'number' && !Number.isNaN(t)) ? `${t.toFixed(1)}°C` : '--';

  const formatBattery = (b) =>
    (typeof b === 'number' && !Number.isNaN(b)) ? `${b}%` : '--';

  const batteryColor = (b) => {
    if (typeof b !== 'number') return '#1e293b'; // neutro quando undefined/null
    return b < 20 ? '#ef4444' : '#1e293b';
  };

  return (
    <div className="menu-container">
      <h2 style={{ color: '#1e293b', marginBottom: 20 }}>📦 Visão Geral das Caixas</h2>

      <div className="caixa-grid">
        {(estoqueConfig || []).map((item) => {
          const dados = resumoEstoque[item.id];
          const score = dados ? dados.score : null;
          const corStatus = getStatusColor(score);

          // Determina "offline/aguardando" com base no status_operacional ou erro real
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
                {/* TEMPERATURA */}
                <div className="stat-item">
                  <small>Temperatura</small>
                  <strong>
                    {/* Só mostra temperatura quando não está aguardando/offline */}
                    {!isOfflineOrAguardando && dados && dados.temp !== null
                      ? formatTemp(dados.temp)
                      : '--'}
                  </strong>
                </div>

                {/* BATERIA */}
                <div className="stat-item">
                  <small>Bateria</small>
                  <strong style={{ color: batteryColor(dados?.bateria) }}>
                    {/* Bateria pode ser undefined (pc alimentando) -> mostra -- */}
                    {!isOfflineOrAguardando && dados && typeof dados.bateria === 'number'
                      ? formatBattery(dados.bateria)
                      : '--'}
                  </strong>
                </div>

                {/* ID */}
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
