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

  // --- LÓGICA DE SEGURANÇA ---
  const isViolado = analise.telemetria.violacao; // Vem da API/ESP32
  const isAberta = analise.telemetria.tampa_aberta; // Vem da API/ESP32

  // Define a cor da borda/fundo baseado no perigo
  let containerClass = "";
  if (isViolado) containerClass = "alert-violation";
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
        <h2 style={{color: isViolado ? 'red' : '#334155'}}>
            {isViolado ? "⚠️ CAIXA VIOLADA ⚠️" : `Analítica: ${caixaNome}`}
        </h2>
        {isAberta && !isViolado && <span className="tag-aberta">TAMPA ABERTA</span>}
      </div>

      <StatusBadge 
        status={analise.analise_risco.status_operacional} 
        cor={analise.analise_risco.indicador_led} 
        recomendacao={analise.analise_risco.recomendacao} 
      />

      <div className="stats-grid">
        <StatCard 
          titulo="Saúde da Caixa" 
          valor={analise.analise_risco.health_score} 
          unidade="%" 
          cor={analise.analise_risco.health_score < 60 ? '#ef4444' : '#16a34a'} 
        />
        <StatCard 
          titulo="Temperatura" 
          valor={analise.telemetria.temperatura_atual} 
          unidade="°C" 
          cor="#2563eb"
        />
        <StatCard 
          titulo="Segurança" 
          valor={isViolado ? "CRÍTICO" : (isAberta ? "ALERTA" : "OK")} 
          unidade="" 
          cor={isViolado ? '#ef4444' : (isAberta ? '#eab308' : '#22c55e')} 
        />
        {/* Usamos Bateria caso venha da API, senão placeholder */}
        <StatCard 
          titulo="Bateria" 
          valor={analise.telemetria.bateria_atual || "--"} 
          unidade="%" 
          cor="#8b5cf6" 
        />
      </div>

      <div className="panel">
        <h3>Histórico em Tempo Real</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={analise.telemetria.historico.map(d => ({
                ...d, 
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
              <Line 
                type="step" 
                dataKey="aberta" 
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