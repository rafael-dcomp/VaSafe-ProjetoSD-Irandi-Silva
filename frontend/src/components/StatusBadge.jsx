import React from 'react';

export default function StatusBadge({ status, cor, recomendacao }) {
  // Se a cor vier como hex (#fff), usamos ela. Se não vier, padrão cinza.
  const corFundo = cor || '#cbd5e1';
  
  // Lógica simples de contraste: se for muito escuro (preto/fraude), letra branca
  const isDark = corFundo === '#000000' || corFundo === '#ef4444';

  return (
    <div style={{ 
      backgroundColor: corFundo + '33', // 33 adiciona transparência (aprox 20%)
      border: `2px solid ${corFundo}`,
      color: isDark ? '#000' : '#1e293b', 
      padding: '20px', 
      borderRadius: '8px', 
      textAlign: 'center',
      marginBottom: '20px'
    }}>
      <h2 style={{ margin: 0, fontSize: '2rem', color: corFundo }}>{status}</h2>
      <p style={{ margin: '10px 0 0 0', fontWeight: 'bold' }}>{recomendacao}</p>
    </div>
  );
}