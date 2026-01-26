import { useState } from 'react';

export default function SetupScreen({ onConfirmarConfiguracao }) {
  const [quantidade, setQuantidade] = useState(20);
  const [nomeLote, setNomeLote] = useState('Lote Simulado');
  const [conteudo, setConteudo] = useState('Dados Virtuais');
  const [local, setLocal] = useState('Servidor Nuvem');

  const handleGerar = (e) => {
    e.preventDefault();

    const caixaReal = {
      id: 'box_01',
      nome: 'ESP32 FÍSICA',
      conteudo: 'Sensor DHT11 Real',
      local: 'Minha Bancada',
      status: 'AGUARDANDO'
    };

    const novasCaixas = [caixaReal];

    for (let i = 2; i <= quantidade; i++) {

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