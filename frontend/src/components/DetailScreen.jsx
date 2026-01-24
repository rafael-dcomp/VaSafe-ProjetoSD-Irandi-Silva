import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import StatusBadge from './StatusBadge';
import StatCard from './StatCard';

const API_URL = "http://localhost:8000";

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
      <div style={{textAlign:'center', padding:'50px', color:'#94a3b8'}}>
        <h2>⌛</h2>
        <p>Carregando Digital Twin...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="controls-area" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <button onClick={onVoltar} className="btn-voltar">
          ⬅ Voltar para o Estoque
        </button>
        <div style={{fontSize:'12px', color: '#94a3b8'}}>
          {lastUpdate ? `📡 Atualizado às: ${lastUpdate}` : 'Conectando...'}
        </div>
      </div>

      <h2 style={{marginTop: 0, color:'#334155'}}>
        Analítica: {caixaNome}
      </h2>

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
          titulo="Bateria" 
          valor={analise.telemetria.bateria_atual} 
          unidade="%" 
          cor="#8b5cf6" 
        />
        <StatCard 
          titulo="Umidade" 
          valor={analise.telemetria.umidade_atual} 
          unidade="%" 
          cor="#0891b2"
        />
      </div>

      <div className="panel">
        <h3>Histórico: Temperatura vs Bateria</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={analise.telemetria.historico.map(d => ({
                ...d, 
                time: new Date(d.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})
              })).reverse()}>
              
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="time" tick={{fontSize: 12}} />
              <YAxis yAxisId="left" domain={['auto', 'auto']} unit="°C" stroke="#2563eb" />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" stroke="#8b5cf6"/>
              <Tooltip contentStyle={{borderRadius:'8px'}}/>
              <Legend />

              <Line yAxisId="left" type="monotone" dataKey="temperatura" stroke="#2563eb" strokeWidth={3} dot={false} isAnimationActive={false} name="Temp (°C)" />
              <Line yAxisId="right" type="monotone" dataKey="bateria" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} name="Bateria (%)" />
              <Line yAxisId="left" type="monotone" dataKey={() => 8} stroke="#ef4444" strokeDasharray="5 5" name="Limite Max" dot={false} />
            
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}