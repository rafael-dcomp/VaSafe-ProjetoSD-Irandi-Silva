import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = "http://localhost:8000";

const getStatusColor = (score) => {
  if (score === undefined || score === null) return '#cbd5e1'; 
  if (score === 0) return '#000000'; // Preto para fraude/violação
  if (score >= 90) return '#22c55e'; 
  if (score >= 60) return '#eab308'; 
  return '#ef4444'; 
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
          score: res.data.analise_risco.health_score,
          temp: res.data.telemetria.temperatura_atual,
          status: res.data.analise_risco.status_operacional
        };
      } catch (e) {
        novosStatus[item.id] = { score: null, temp: 0, erro: true };
      }
    }));
    
    setResumoEstoque(novosStatus);
  }, [estoqueConfig]);

  useEffect(() => {
    fetchVisaoGeral();
    const interval = setInterval(fetchVisaoGeral, 3000);
    return () => clearInterval(interval);
  }, [fetchVisaoGeral]);

  return (
    <div className="menu-container">
      <h2 style={{color: '#1e293b', marginBottom: '20px'}}>📦 Visão Geral das Caixas</h2>
      
      <div className="caixa-grid">
        {estoqueConfig.map((item) => {
          const dados = resumoEstoque[item.id];
          const score = dados ? dados.score : null;
          const corStatus = getStatusColor(score);
          const isErro = dados?.erro;
          
          return (
            <div 
              key={item.id} 
              className="caixa-card"
              onClick={() => onSelectCaixa(item.id)}
              style={{ borderTop: `6px solid ${corStatus}` }}
            >
              <div className="caixa-header">
                <div className="icon-bg" style={{backgroundColor: corStatus + '20'}}>
                  <span style={{fontSize: '20px'}}>❄️</span>
                </div>
                <span className="status-pill" style={{backgroundColor: corStatus, color: '#fff'}}>
                  {isErro ? 'OFFLINE' : (score === 0 ? 'FRAUDE' : `${score}% Saúde`)}
                </span>
              </div>

              <h3>{item.nome}</h3>
              <p style={{color:'#64748b', fontSize:'0.85rem', marginBottom:'15px'}}>
                {item.conteudo} • {item.local}
              </p>
              
              <div className="caixa-stats-row">
                <div className="stat-item">
                  <small>Temperatura</small>
                  <strong>{dados && !isErro ? `${dados.temp.toFixed(1)}°C` : '--'}</strong>
                </div>
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