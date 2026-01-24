import React from 'react';

export default function StatCard({ titulo, valor, unidade, cor }) {
  return (
    <div style={{
      backgroundColor: 'white',
      padding: '15px',
      borderRadius: '10px',
      boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: `4px solid ${cor || '#ccc'}`
    }}>
      <span style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '5px' }}>
        {titulo}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b' }}>
          {valor}
        </span>
        <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
          {unidade}
        </span>
      </div>
    </div>
  );
}