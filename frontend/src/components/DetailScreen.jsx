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

  const fetchDetalhe = useCallback(async () => {
    try {
      const timestamp = Date.now();
      const res = await axios.get(`${API_URL}/analise/${caixaId}?t=${timestamp}`);
      setAnalise(res.data);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (e) { 
      console.error("Erro ao detalhar caixa:", e);
      // Se der erro, não faz nada para manter o último estado ou o loading
    }
  }, [caixaId]);

  useEffect(() => {
    fetchDetalhe();
    const interval = setInterval(fetchDetalhe, 3000);
    return () => clearInterval(interval);
  }, [fetchDetalhe]);

  if (!analise) {
    return (
      <div className="loading-container">
        <h2>⌛</h2>
        <p>Conectando ao Digital Twin...</p>
      </div>
    );
  }

  // --- LÓGICA DE SEGURANÇA E DADOS ---
  const { telemetria, analise_risco } = analise;
  const isViolado = telemetria.violacao; 
  const isAberta = telemetria.tampa_aberta;
  const isOffline = analise_risco.health_score === null;

  // Define a cor da borda/fundo baseado no perigo
  let containerClass = "";
  if (isOffline) containerClass = "alert-offline"; // Classe CSS opcional para cinza
  else if (isViolado) containerClass = "alert-violation";
  else if (isAberta) containerClass = "alert-open";

  return (
    <div className={`detail-wrapper ${containerClass}`}>
      <div className="controls-area">
        <button onClick={onVoltar} className="btn-voltar">
          ⬅ Voltar para o Estoque
        </button>
        <div className="update-badge">
          {lastUpdate ? `📡 Atualizado: ${lastUpdate}` : 'Conectando...'}
        </div>
      </div>

      <div className="header-detail">
        <h2 style={{color: isViolado ? '#ef4444' : (isOffline ? '#64748b' : '#334155')}}>
            {isOffline ? `OFFLINE: ${caixaNome}` : (isViolado ? "⚠️ CAIXA VIOLADA ⚠️" : `Analítica: ${caixaNome}`)}
        </h2>
        {isAberta && !isViolado && !isOffline && <span className="tag-aberta">TAMPA ABERTA</span>}
      </div>

      <StatusBadge 
        status={analise_risco.status_operacional} 
        cor={analise_risco.indicador_led} 
        recomendacao={analise_risco.recomendacao} 
      />

      <div className="stats-grid">
        <StatCard 
          titulo="Saúde da Caixa" 
          valor={isOffline ? "--" : analise_risco.health_score} 
          unidade={isOffline ? "" : "%"} 
          cor={analise_risco.health_score < 60 ? '#ef4444' : '#16a34a'} 
        />
        <StatCard 
          titulo="Temperatura" 
          valor={telemetria.temperatura_atual} 
          unidade="°C" 
          cor="#2563eb"
        />
        <StatCard 
          titulo="Segurança" 
          valor={isViolado ? "CRÍTICO" : (isAberta ? "ALERTA" : "OK")} 
          unidade="" 
          cor={isViolado ? '#ef4444' : (isAberta ? '#eab308' : '#22c55e')} 
        />
        
        {/* CORRIGIDO: Agora lê 'bateria' direto da telemetria e trata offline */}
        <StatCard 
          titulo="Bateria" 
          valor={telemetria.bateria !== undefined ? telemetria.bateria : "--"} 
          unidade="%" 
          cor={telemetria.bateria < 20 ? '#ef4444' : '#8b5cf6'} 
        />
      </div>

      <div className="panel">
        <h3>Histórico em Tempo Real</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={telemetria.historico.map(d => ({
                ...d, 
                // Formata hora
                time: new Date(d.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})
              })).reverse()}>
              
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="time" tick={{fontSize: 12}} />
              <YAxis domain={['auto', 'auto']} unit="°C" stroke="#2563eb" />
              <Tooltip contentStyle={{borderRadius:'8px'}}/>
              <Legend />

              <Line 
                type="monotone" 
                dataKey="temperatura" 
                stroke={isViolado ? "#000000" : "#2563eb"} 
                strokeWidth={3} 
                dot={false} 
                name="Temp (°C)" 
              />
              {/* CORRIGIDO: dataKey deve ser 'tampa_aberta' conforme API */}
              <Line 
                type="step" 
                dataKey="tampa_aberta" 
                stroke="#eab308" 
                strokeWidth={2} 
                dot={false} 
                name="Tampa Aberta (0/1)" 
              />
            
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}