import React from 'react';

export default function StatusBadge({ status, cor, recomendacao }) {
  // Garante uma cor padrão caso venha null
  const corFundo = cor || '#cbd5e1'; 
  
  // Decide se o texto deve ser branco (para fundos escuros) ou preto
  // #000000 (Preto/Fraude) e #ef4444 (Vermelho/Crítico) precisam de texto claro
  const isDarkBg = corFundo === '#000000' || corFundo === '#ef4444' || corFundo === '#1e293b';

  return (
    <div style={{ 
      backgroundColor: corFundo + '20', // 20% de opacidade no fundo
      border: `2px solid ${corFundo}`,
      color: '#1e293b', // Texto padrão escuro para leitura
      padding: '20px', 
      borderRadius: '8px', 
      textAlign: 'center',
      marginBottom: '20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <h2 style={{ 
        margin: 0, 
        fontSize: '2rem', 
        color: corFundo, // O título ganha a cor do status
        fontWeight: '800'
      }}>
        {status || "DESCONHECIDO"}
      </h2>
      <p style={{ 
        margin: '10px 0 0 0', 
        fontWeight: '500',
        fontSize: '1.1rem',
        color: '#475569'
      }}>
        {recomendacao || "Sem dados disponíveis."}
      </p>
    </div>
  );
}