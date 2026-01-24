import React from 'react';

export default function Header({ onLogout }) {
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 2rem', backgroundColor: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '24px' }}>🚛</span>
        <h1 style={{ margin: 0, fontSize: '1.2rem', color: '#333' }}>VaSafe <span style={{fontWeight:'normal', color:'#666'}}>| Digital Twin Logistics</span></h1>
      </div>
      <button onClick={onLogout} style={{ padding: '8px 16px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
        Sair do Sistema
      </button>
    </header>
  );
}