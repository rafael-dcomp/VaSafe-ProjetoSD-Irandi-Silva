import React from 'react';

const cores = {
  'VERDE': { bg: '#d4edda', color: '#155724', border: '#c3e6cb' },
  'AMARELO': { bg: '#fff3cd', color: '#856404', border: '#ffeeba' },
  'LARANJA': { bg: '#ffe5d0', color: '#d35400', border: '#ffdbcc' },
  'VERMELHO': { bg: '#f8d7da', color: '#721c24', border: '#f5c6cb' }
};

export default function StatusBadge({ status, cor, recomendacao }) {
  const estilo = cores[cor] || cores['AMARELO'];

  return (
    <div style={{ 
      backgroundColor: estilo.bg, 
      color: estilo.color, 
      border: `1px solid ${estilo.border}`,
      padding: '20px', 
      borderRadius: '8px', 
      textAlign: 'center',
      marginBottom: '20px'
    }}>
      <h2 style={{ margin: 0, fontSize: '2rem' }}>{status}</h2>
      <p style={{ margin: '10px 0 0 0', fontWeight: 'bold' }}>{recomendacao}</p>
    </div>
  );
}