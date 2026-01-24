import React from 'react';

export default function StatCard({ titulo, valor, unidade, cor = "#333" }) {
  return (
    <div style={{ background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)', flex: 1, textAlign: 'center' }}>
      <h4 style={{ margin: '0 0 10px 0', color: '#7f8c8d', textTransform: 'uppercase', fontSize: '0.8rem' }}>{titulo}</h4>
      <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: cor }}>
        {valor}<span style={{ fontSize: '1rem', color: '#999' }}>{unidade}</span>
      </div>
    </div>
  );
}