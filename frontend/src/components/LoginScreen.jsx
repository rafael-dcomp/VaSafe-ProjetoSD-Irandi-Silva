import { useState } from 'react';
import axios from 'axios';

const API_URL = "http://54.197.203.94:8000";

export default function LoginScreen({ onLoginSuccess }) {
  const [user, setUser] = useState(""); 
  const [pass, setPass] = useState("");
  const [error, setError] = useState(false);

  const handleLogin = async () => {
    try {
      await axios.post(`${API_URL}/login`, { usuario: user, senha: pass });
      onLoginSuccess(); // Avisa o App que logou
    } catch (err) {
      setError(true);
      alert("Erro. Tente admin/admin");
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div style={{fontSize:'40px', marginBottom:'10px'}}>🧊</div>
        <h2>VaSafe Monitoramento</h2>
        <p style={{color:'#666', marginBottom:'20px'}}>Gestão de Caixas Térmicas</p>
        
        <input 
          className="login-input" 
          placeholder="Usuário" 
          value={user}
          onChange={e => setUser(e.target.value)} 
        />
        <input 
          className="login-input" 
          type="password" 
          placeholder="Senha" 
          value={pass}
          onChange={e => setPass(e.target.value)} 
        />
        
        <button className="login-btn" onClick={handleLogin}>
          Acessar Sistema
        </button>
      </div>
    </div>
  );
}