import { useState } from 'react';
import './App.css'; 

import Header from './components/Header';
import LoginScreen from './components/LoginScreen';
import DashboardScreen from './components/DashboardScreen';
import DetailScreen from './components/DetailScreen';

const ESTOQUE_CONFIG = [
  { id: 'Lote-A', nome: 'Caixa 01 - Pfizer', conteudo: 'Vacinas COVID', local: 'Expedição A' },
  { id: 'Lote-B', nome: 'Caixa 02 - Insulina', conteudo: 'Insulina NPH', local: 'Estoque Frio' },
  { id: 'Lote-C', nome: 'Caixa 03 - Amostras', conteudo: 'Sangue Total', local: 'Triagem' },
];

function App() {
  const [token, setToken] = useState(null);
  const [selectedCaixaId, setSelectedCaixaId] = useState(null);

  if (!token) {
    return <LoginScreen onLoginSuccess={() => setToken("logado")} />;
  }
  return (
    <div className="app-root">
      <Header onLogout={() => setToken(null)} />

      <main className="dashboard-container">
        
        {!selectedCaixaId ? (
          <DashboardScreen 
            estoqueConfig={ESTOQUE_CONFIG} 
            onSelectCaixa={(id) => setSelectedCaixaId(id)} 
          />
        ) : (
          <DetailScreen 
            caixaId={selectedCaixaId}
            caixaNome={ESTOQUE_CONFIG.find(c => c.id === selectedCaixaId)?.nome}
            onVoltar={() => setSelectedCaixaId(null)}
          />
        )}

      </main>
    </div>
  );
}

export default App;