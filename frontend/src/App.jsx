import { useState } from 'react';
import './App.css'; 

import Header from './components/Header';
import LoginScreen from './components/LoginScreen';
import SetupScreen from './components/SetupScreen'; // Importando a tela de configuração
import DashboardScreen from './components/DashboardScreen';
import DetailScreen from './components/DetailScreen';

function App() {
  // 1. Estado de Autenticação
  const [token, setToken] = useState(null);
  
  // 2. Estado do Estoque (Substitui o ESTOQUE_CONFIG fixo)
  // Começa vazio e será preenchido pelo SetupScreen
  const [estoque, setEstoque] = useState([]); 
  
  // 3. Controle para saber se o usuário já configurou o teste
  const [setupConcluido, setSetupConcluido] = useState(false);

  // 4. Controle de navegação (qual caixa está sendo detalhada)
  const [selectedCaixaId, setSelectedCaixaId] = useState(null);

  // --- FUNÇÃO DE LOGOUT / RESET ---
  const handleLogout = () => {
    setToken(null);
    setSetupConcluido(false); // Força configurar de novo ao relogar
    setEstoque([]); // Limpa a memória
    setSelectedCaixaId(null);
  };

  // --- RENDERIZAÇÃO CONDICIONAL (O Fluxo do App) ---

  // CASO 1: Usuário NÃO logado -> Tela de Login
  if (!token) {
    return <LoginScreen onLoginSuccess={() => setToken("logado")} />;
  }

  // CASO 2: Usuário logado, mas ainda NÃO configurou o lote -> Tela de Setup
  if (!setupConcluido) {
    return (
      <div className="app-root">
         <Header onLogout={handleLogout} />
         <div className="dashboard-container">
            {/* Aqui recebemos a lista criada no Setup (Real + Simuladas) */}
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

  // CASO 3: Usuário logado e configurado -> Dashboard ou Detalhes
  return (
    <div className="app-root">
      <Header onLogout={handleLogout} />

      <main className="dashboard-container">
        
        {!selectedCaixaId ? (
          // --- TELA PRINCIPAL (GRID) ---
          <DashboardScreen 
            estoqueConfig={estoque} // Passamos a lista dinâmica gerada
            onSelectCaixa={(id) => setSelectedCaixaId(id)} 
          />
        ) : (
          // --- TELA DE DETALHES (GRÁFICOS) ---
          <DetailScreen 
            caixaId={selectedCaixaId}
            // Procura o nome correto dentro da lista dinâmica
            caixaNome={estoque.find(c => c.id === selectedCaixaId)?.nome || 'Caixa Desconhecida'}
            onVoltar={() => setSelectedCaixaId(null)}
          />
        )}

      </main>
    </div>
  );
}

export default App;