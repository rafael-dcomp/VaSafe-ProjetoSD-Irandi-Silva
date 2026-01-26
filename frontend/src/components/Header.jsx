import React from 'react';

export default function Header({ onLogout }) {
  return (
    <header style={{ 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      padding: '1rem 2rem', 
      backgroundColor: '#fff', 
      borderBottom: '1px solid #e2e8f0' 
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        
        <img 
          src="/vite.svg" 
          alt="Ícone VaSafe" 
          style={{ 
            height: '70px', 
            width: 'auto' 
          }} 
        />

        <h1 style={{ margin: 0, fontSize: '1.2rem', color: '#333' }}>
          VaSafe <span style={{fontWeight:'normal', color:'#666'}}>| Monitoramento Inteligente da Cadeia dos Frios</span>
        </h1>
      </div>

      <button onClick={onLogout} style={{ 
        padding: '8px 16px', 
        background: '#e74c3c', 
        color: 'white', 
        border: 'none', 
        borderRadius: '4px', 
        cursor: 'pointer',
        fontWeight: 'bold'
      }}>
        Sair
      </button>
    </header>
  );
}