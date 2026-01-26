import { useState } from 'react';

export default function SetupScreen({ onConfirmarConfiguracao }) {
  // Estados do formulário
  const [quantidade, setQuantidade] = useState(20);
  const [nomeLote, setNomeLote] = useState('Lote Simulado');
  const [conteudo, setConteudo] = useState('Dados Virtuais');
  const [local, setLocal] = useState('Servidor Nuvem');

  const handleGerar = (e) => {
    e.preventDefault();

    // --- 1. CRIAR A CAIXA REAL (ESP32) ---
    // Esta é a caixa que vai receber os dados reais do seu sensor
    const caixaReal = {
      id: 'box_01',
      nome: '⭐ ESP32 FÍSICA',
      conteudo: 'Sensor DHT11 Real',
      local: 'Minha Bancada',
      status: 'AGUARDANDO'
    };

    // Começamos a lista com a caixa real
    const novasCaixas = [caixaReal];

    // --- 2. GERAR AS CAIXAS SIMULADAS ---
    // O loop começa em 2 para não sobrescrever a box_01
    for (let i = 2; i <= quantidade; i++) {
      
      // Formatação: box_02, box_03, ..., box_10, etc.
      const numeroFormatado = i < 10 ? `0${i}` : i;
      const idGerado = `box_${numeroFormatado}`;

      novasCaixas.push({
        id: idGerado,
        nome: `${nomeLote} #${i}`,
        conteudo: conteudo,
        local: local,
        status: 'AGUARDANDO'
      });
    }

    console.log(`Ambiente gerado: 1 Real + ${novasCaixas.length - 1} Simuladas.`);
    
    // Envia a lista completa para o App.jsx
    onConfirmarConfiguracao(novasCaixas);
  };

  return (
    <div className="setup-wrapper">
      <div className="setup-card">
        
        <div className="setup-header">
          <h2>Teste de Carga Híbrido</h2>
          <p>
            A <strong>box_01</strong> será sua ESP32 Física. 
            As demais serão simuladas virtualmente.
          </p>
        </div>

        <form onSubmit={handleGerar} className="setup-form">
          
          {/* Campo Quantidade Total */}
          <div className="form-group">
            <label>Quantidade TOTAL de Caixas:</label>
            <input 
              type="number" 
              className="form-control"
              min="2" 
              max="500"
              value={quantidade} 
              onChange={(e) => setQuantidade(Number(e.target.value))} 
              placeholder="Ex: 50"
            />
            <small style={{ color: '#64748b', marginTop: '5px' }}>
              Isso criará a caixa real + {quantidade - 1} caixas virtuais.
            </small>
          </div>

          {/* Campos de Detalhes (Lado a Lado) */}
          <div className="form-row">
            <div className="form-group">
               <label>Nome do Lote Virtual:</label>
               <input 
                  type="text" 
                  className="form-control"
                  value={nomeLote} 
                  onChange={(e) => setNomeLote(e.target.value)}
                  placeholder="Lote Simulado"
               />
            </div>
            <div className="form-group">
              <label>Conteúdo Virtual:</label>
              <input 
                type="text" 
                className="form-control"
                value={conteudo} 
                onChange={(e) => setConteudo(e.target.value)}
                placeholder="Ex: Vacinas"
              />
            </div>
          </div>

          {/* Campo Local */}
          <div className="form-group">
            <label>Local Virtual:</label>
            <input 
              type="text" 
              className="form-control"
              value={local} 
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Ex: Nuvem AWS"
            />
          </div>

          <button type="submit" className="btn-setup">
            GERAR AMBIENTE E INICIAR
          </button>
        </form>
      </div>
    </div>
  );
}