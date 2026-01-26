import { useState } from 'react';
import axios from 'axios';
import completo from '../assets/completo.png'; 

const API_URL = "http://98.90.117.5:8000";

export default function LoginScreen({ onLoginSuccess }) {
  const [user, setUser] = useState(""); 
  const [pass, setPass] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    if (e) e.preventDefault();

    setLoading(true);
    setError(false);

    try {
      await axios.post(`${API_URL}/login`, { usuario: user, senha: pass });
      onLoginSuccess(); 
    } catch (err) {
      setError(true);
      console.error("Erro no login:", err);
      alert("Erro de autenticação. Tente admin/admin");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center',
          marginBottom: '20px' 
        }}>
          <img 
            src={completo} 
            alt="VaSafe Logo" 
            style={{ 
              height: '70px',
              width: 'auto',  
              objectFit: 'contain' 
            }} 
          />
        </div>

        <h2 style={{ marginBottom: '5px' }}>Acesso Restrito</h2>
        <p style={{ color: '#666', marginBottom: '25px', fontSize: '0.9rem' }}>
          Gestão de Caixas Térmicas
        </p>
        
        <form onSubmit={handleLogin}>
          <input 
            className="login-input" 
            placeholder="Usuário" 
            value={user}
            onChange={e => setUser(e.target.value)}
            disabled={loading}
          />
          <input 
            className="login-input" 
            type="password" 
            placeholder="Senha" 
            value={pass}
            onChange={e => setPass(e.target.value)} 
            disabled={loading}
          />
          
          {error && <p style={{ color: 'red', fontSize: '0.8rem' }}>Usuário ou senha inválidos.</p>}

          <button 
            type="submit" 
            className="login-btn" 
            disabled={loading}
            style={{ cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? 'Entrando...' : 'Acessar Sistema'}
          </button>
        </form>
      </div>
    </div>
  );
}