import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = "http://98.88.32.2:8000";

// Função para decidir a cor da borda e do ícone
const getStatusColor = (score) => {
  if (score === undefined || score === null) return '#cbd5e1'; // Cinza (Offline/Aguardando)
  if (score === 0) return '#000000'; // Preto (Fraude/Violação)
  if (score >= 90) return '#22c55e'; // Verde (Ótimo)
  if (score >= 60) return '#eab308'; // Amarelo (Atenção)
  return '#ef4444'; // Laranja/Vermelho (Risco)
};

export default function DashboardScreen({ estoqueConfig = [], onSelectCaixa }) {
  const [resumoEstoque, setResumoEstoque] = useState({});

  const fetchVisaoGeral = useCallback(async () => {
    const timestamp = Date.now();
    const novosStatus = {};

    await Promise.all(
      (estoqueConfig || []).map(async (item) => {
        try {
          const res = await axios.get(`${API_URL}/analise/${item.id}?t=${timestamp}`);

          // A API agora pode retornar `offline: true/false` e bateria pode ser null
          const apiOffline = res.data?.offline === true;

          novosStatus[item.id] = {
            score: res.data?.analise_risco?.health_score ?? null, // Pode ser null, 0 ou 0-100
            temp: res.data?.telemetria?.temperatura_atual ?? null, // number | null
            bateria: res.data?.telemetria?.bateria ?? null, // number | null
            status: res.data?.analise_risco?.status_operacional ?? null,
            erro: apiOffline // true quando a API indica offline ou hardware sem dados
          };
        } catch (e) {
          // Se a API cair ou der timeout, marca erro e preserva valores nulos
          novosStatus[item.id] = {
            score: null,
            temp: null,
            bateria: null,
            status: null,
            erro: true
          };
        }
      })
    );

    setResumoEstoque(novosStatus);
  }, [estoqueConfig]);

  useEffect(() => {
    fetchVisaoGeral();
    const interval = setInterval(fetchVisaoGeral, 3000);
    return () => clearInterval(interval);
  }, [fetchVisaoGeral]);

  // Função auxiliar para renderizar o texto do status
  const renderStatusLabel = (score, isErro) => {
    if (isErro) return 'OFFLINE';
    if (score === null || score === undefined) return 'AGUARDANDO';
    if (score === 0) return 'FRAUDE';
    return `${score}% Saúde`;
  };

  // Helpers para exibição segura
  const formatTemp = (t) =>
    typeof t === 'number' && !Number.isNaN(t) ? `${t.toFixed(1)}°C` : '--';

  const formatBattery = (b) =>
    typeof b === 'number' && !Number.isNaN(b) ? `${b}%` : '--';

  const batteryColor = (b) => {
    if (typeof b !== 'number') return '#1e293b'; // neutro quando sem dado
    return b < 20 ? '#ef4444' : '#1e293b';
  };

  return (
    <div className="menu-container">
      <h2 style={{ color: '#1e293b', marginBottom: '20px' }}>📦 Visão Geral das Caixas</h2>

      <div className="caixa-grid">
        {(estoqueConfig || []).map((item) => {
          const dados = resumoEstoque[item.id];
          const score = dados ? dados.score : null;
          const corStatus = getStatusColor(score);

          // Consideramos offline apenas quando a flag de erro/offline estiver true
          const isOffline = dados?.erro === true;

          return (
            <div
              key={item.id}
              className="caixa-card"
              onClick={() => onSelectCaixa(item.id)}
              style={{ borderTop: `6px solid ${corStatus}` }}
            >
              <div className="caixa-header">
                <div className="icon-bg" style={{ backgroundColor: corStatus + '20' }}>
                  {/* Muda o ícone se for Fraude */}
                  <span style={{ fontSize: '20px' }}>{score === 0 ? '⚠️' : '❄️'}</span>
                </div>
                <span className="status-pill" style={{ backgroundColor: corStatus, color: '#fff' }}>
                  {renderStatusLabel(score, dados?.erro)}
                </span>
              </div>

              <h3>{item.nome}</h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '15px' }}>
                {item.conteudo} • {item.local}
              </p>

              <div className="caixa-stats-row">
                {/* TEMPERATURA */}
                <div className="stat-item">
                  <small>Temperatura</small>
                  <strong>{dados && !isOffline ? formatTemp(dados.temp) : '--'}</strong>
                </div>

                {/* BATERIA */}
                <div className="stat-item">
                  <small>Bateria</small>
                  <strong style={{ color: batteryColor(dados?.bateria) }}>
                    {dados && !isOffline ? formatBattery(dados.bateria) : '--'}
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
