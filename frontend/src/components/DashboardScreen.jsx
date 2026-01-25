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

export default function DashboardScreen({ estoqueConfig, onSelectCaixa }) {
  const [resumoEstoque, setResumoEstoque] = useState({});

  const fetchVisaoGeral = useCallback(async () => {
    const timestamp = Date.now();
    const novosStatus = {};

    await Promise.all(estoqueConfig.map(async (item) => {
      try {
        const res = await axios.get(`${API_URL}/analise/${item.id}?t=${timestamp}`);
        
        novosStatus[item.id] = {
          score: res.data.analise_risco.health_score, // Pode ser null, 0 ou 0-100
          temp: res.data.telemetria.temperatura_atual,
          bateria: res.data.telemetria.bateria,
          status: res.data.analise_risco.status_operacional,
          erro: false
        };
      } catch (e) {
        // Se a API cair ou der timeout
        novosStatus[item.id] = { score: null, temp: 0, bateria: 0, erro: true };
      }
    }));
    
    setResumoEstoque(novosStatus);
  }, [estoqueConfig]);

  useEffect(() => {
    fetchVisaoGeral();
    const interval = setInterval(fetchVisaoGeral, 3000);
    return () => clearInterval(interval);
  }, [fetchVisaoGeral]);

  // Função auxiliar para renderizar o texto do status
  const renderStatusLabel = (score, isErro) => {
    if (isErro || score === null) return 'OFFLINE';
    if (score === 0) return 'FRAUDE';
    return `${score}% Saúde`;
  };

  return (
    <div className="menu-container">
      <h2 style={{color: '#1e293b', marginBottom: '20px'}}>📦 Visão Geral das Caixas</h2>
      
      <div className="caixa-grid">
        {estoqueConfig.map((item) => {
          const dados = resumoEstoque[item.id];
          const score = dados ? dados.score : null;
          const corStatus = getStatusColor(score);
          
          // Se score for null ou tiver flag de erro, consideramos offline
          const isOffline = dados?.erro || score === null;
          
          return (
            <div 
              key={item.id} 
              className="caixa-card"
              onClick={() => onSelectCaixa(item.id)}
              style={{ borderTop: `6px solid ${corStatus}` }}
            >
              <div className="caixa-header">
                <div className="icon-bg" style={{backgroundColor: corStatus + '20'}}>
                   {/* Muda o ícone se for Fraude */}
                   <span style={{fontSize: '20px'}}>
                     {score === 0 ? '⚠️' : '❄️'}
                   </span>
                </div>
                <span className="status-pill" style={{backgroundColor: corStatus, color: '#fff'}}>
                  {renderStatusLabel(score, dados?.erro)}
                </span>
              </div>

              <h3>{item.nome}</h3>
              <p style={{color:'#64748b', fontSize:'0.85rem', marginBottom:'15px'}}>
                {item.conteudo} • {item.local}
              </p>
              
              <div className="caixa-stats-row">
                {/* TEMPERATURA */}
                <div className="stat-item">
                  <small>Temperatura</small>
                  <strong>{dados && !isOffline ? `${dados.temp.toFixed(1)}°C` : '--'}</strong>
                </div>

                {/* BATERIA */}
                <div className="stat-item">
                   <small>Bateria</small>
                   <strong style={{ color: dados?.bateria < 20 ? '#ef4444' : '#1e293b'}}>
                     {dados && !isOffline ? `${dados.bateria}%` : '--'}
                   </strong>
                </div>
                
                {/* ID */}
                <div className="stat-item">
                   <small>ID</small>
                   <span style={{fontSize:'0.8rem'}}>{item.id}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}