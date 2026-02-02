import { useState } from 'react';
import './App.css'; 

import Header from './components/Header';
import LoginScreen from './components/LoginScreen';
import SetupScreen from './components/SetupScreen'; 
import DashboardScreen from './components/DashboardScreen';
import DetailScreen from './components/DetailScreen';

function App() {
  const [token, setToken] = useState(null);
  const [estoque, setEstoque] = useState([]); 
  const [setupConcluido, setSetupConcluido] = useState(false);
  const [selectedCaixaId, setSelectedCaixaId] = useState(null);

  const handleLogout = () => {
    setToken(null);
    setSetupConcluido(false); 
    setEstoque([]); 
    setSelectedCaixaId(null);
  };

  if (!token) {
    return <LoginScreen onLoginSuccess={() => setToken("logado")} />;
  }
  if (!setupConcluido) {
    return (
      <div className="app-root">
         <Header onLogout={handleLogout} />
         <div className="dashboard-container">
            <SetupScreen 
                onConfirmarConfiguracao={(listaGerada) => {
                    setEstoque(listaGerada); // Salva a lista na memória do App
                    setSetupConcluido(true); // Libera o acesso ao Dashboard
                }} 
            />
         </div>
      </div>
    );
  }
  return (
    <div className="app-root">
      <Header onLogout={handleLogout} />

      <main className="dashboard-container">
        
        {!selectedCaixaId ? (
          <DashboardScreen 
            estoqueConfig={estoque} 
            onSelectCaixa={(id) => setSelectedCaixaId(id)} 
          />
        ) : (
          <DetailScreen 
            caixaId={selectedCaixaId}
            caixaNome={estoque.find(c => c.id === selectedCaixaId)?.nome || 'Caixa Desconhecida'}
            onVoltar={() => setSelectedCaixaId(null)}
          />
        )}

      </main>
    </div>
  );
}

export default App;