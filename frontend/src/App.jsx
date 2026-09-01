import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './styles/global.css';

function App() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Estado do jogo
  const [gameState, setGameState] = useState({
    roomCode: null,
    player: null,
    players: [],
    team: [],
    swapsRemaining: 3,
    isReady: false,
    selection: null,
    matchEvents: [],
    matchResult: null,
    matchStatus: 'waiting', // waiting | drafting | ready | playing | finished
    opponent: null
  });

  // Estado da UI
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [view, setView] = useState('home'); // home | lobby | game | result

  // Conectar ao servidor
  useEffect(() => {
    const serverUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('✅ Conectado ao servidor!');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Desconectado do servidor');
      setIsConnected(false);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Eventos do servidor
  useEffect(() => {
    if (!socket) return;

    // ============================================
    // EVENTOS DA SALA
    // ============================================

    socket.on('room-created', (data) => {
      setGameState(prev => ({
        ...prev,
        roomCode: data.roomCode,
        player: data.player,
        players: data.players,
        matchStatus: 'waiting'
      }));
      setView('lobby');
    });

    socket.on('room-joined', (data) => {
      setGameState(prev => ({
        ...prev,
        roomCode: data.roomCode,
        player: data.player,
        players: data.players,
        matchStatus: 'drafting'
      }));
      setView('lobby');
    });

    socket.on('player-joined', (data) => {
      setGameState(prev => ({
        ...prev,
        players: data.players,
        matchStatus: 'drafting'
      }));
    });

    socket.on('player-left', (data) => {
      setGameState(prev => ({
        ...prev,
        players: data.players
      }));
      if (data.players.length < 2) {
        setGameState(prev => ({
          ...prev,
          matchStatus: 'waiting'
        }));
      }
    });

    // ============================================
    // EVENTOS DO JOGO
    // ============================================

    socket.on('roulette-spun', (data) => {
      if (data.playerId === gameState.player?.id) {
        setGameState(prev => ({
          ...prev,
          selection: data.selection
        }));
      }
    });

    socket.on('player-selected', (data) => {
      setGameState(prev => ({
        ...prev,
        team: [...prev.team, data.player],
        isReady: data.isReady,
        selection: null
      }));
    });

    socket.on('swap-used', (data) => {
      setGameState(prev => ({
        ...prev,
        swapsRemaining: data.swapsRemaining,
        selection: null
      }));
    });

    socket.on('opponent-update', (data) => {
      setGameState(prev => ({
        ...prev,
        opponent: data
      }));
    });

    // ============================================
    // EVENTOS DA PARTIDA
    // ============================================

    socket.on('match-ready', (data) => {
      setGameState(prev => ({
        ...prev,
        matchStatus: 'ready',
        players: data.players
      }));
      setView('game');
    });

    socket.on('match-starting', (data) => {
      setGameState(prev => ({
        ...prev,
        matchStatus: 'playing',
        matchEvents: []
      }));
    });

    socket.on('match-event', (data) => {
      setGameState(prev => ({
        ...prev,
        matchEvents: [...prev.matchEvents, data]
      }));
    });

    socket.on('match-ended', (data) => {
      setGameState(prev => ({
        ...prev,
        matchStatus: 'finished',
        matchResult: data.result
      }));
      setView('result');
    });

    socket.on('match-abandoned', (data) => {
      alert(data.message || 'Partida abandonada!');
      setGameState(prev => ({
        ...prev,
        matchStatus: 'waiting'
      }));
      setView('lobby');
    });

    socket.on('reset-game', (data) => {
      setGameState(prev => ({
        ...prev,
        team: [],
        swapsRemaining: 3,
        isReady: false,
        selection: null,
        matchEvents: [],
        matchResult: null,
        matchStatus: 'drafting'
      }));
      setView('game');
    });

    // ============================================
    // ERROS
    // ============================================

    socket.on('error', (data) => {
      alert(`❌ ${data.message}`);
    });

    return () => {
      socket.off('room-created');
      socket.off('room-joined');
      socket.off('player-joined');
      socket.off('player-left');
      socket.off('roulette-spun');
      socket.off('player-selected');
      socket.off('swap-used');
      socket.off('opponent-update');
      socket.off('match-ready');
      socket.off('match-starting');
      socket.off('match-event');
      socket.off('match-ended');
      socket.off('match-abandoned');
      socket.off('reset-game');
      socket.off('error');
    };
  }, [socket, gameState.player?.id]);

  // ============================================================
  // FUNÇÕES DO JOGO
  // ============================================================

  const createRoom = () => {
    if (!name.trim()) {
      alert('Digite seu nome!');
      return;
    }
    socket.emit('create-room', { playerName: name.trim() });
  };

  const joinRoom = () => {
    if (!name.trim() || !roomCode.trim()) {
      alert('Digite seu nome e o código da sala!');
      return;
    }
    socket.emit('join-room', {
      roomCode: roomCode.trim().toUpperCase(),
      playerName: name.trim()
    });
  };

  const spinRoulette = () => {
    if (!gameState.roomCode || gameState.isReady) return;
    socket.emit('spin-roulette', {
      roomCode: gameState.roomCode,
      playerId: gameState.player.id
    });
  };

  const selectPlayer = (playerId, position) => {
    if (!gameState.roomCode || !gameState.player) return;
    socket.emit('select-player', {
      roomCode: gameState.roomCode,
      playerId: gameState.player.id,
      playerCardId: playerId,
      position: position || 'MID'
    });
  };

  const swapSelection = () => {
    if (!gameState.roomCode || !gameState.player) return;
    socket.emit('swap-selection', {
      roomCode: gameState.roomCode,
      playerId: gameState.player.id
    });
  };

  const startMatch = () => {
    if (!gameState.roomCode) return;
    socket.emit('start-match', {
      roomCode: gameState.roomCode
    });
  };

  const playAgain = () => {
    if (!gameState.roomCode) return;
    socket.emit('play-again', {
      roomCode: gameState.roomCode
    });
  };

  const leaveRoom = () => {
    if (!gameState.roomCode || !gameState.player) return;
    socket.emit('leave-room', {
      roomCode: gameState.roomCode,
      playerId: gameState.player.id
    });
    setGameState({
      roomCode: null,
      player: null,
      players: [],
      team: [],
      swapsRemaining: 3,
      isReady: false,
      selection: null,
      matchEvents: [],
      matchResult: null,
      matchStatus: 'waiting',
      opponent: null
    });
    setView('home');
  };

  // ============================================================
  // RENDERIZAÇÃO
  // ============================================================

  // ----- HOME -----
  if (view === 'home') {
    return (
      <div className="home-container">
        <div className="home-content">
          <div className="home-header">
            <div className="home-logo">⚽ OlhaOGol</div>
            <p className="home-subtitle">Monte seu time e desafie seus amigos!</p>
          </div>

          <div className="home-grid">
            {/* Criar Sala */}
            <div className="home-card">
              <h2>🏠 Criar Sala</h2>
              <input
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="home-input"
              />
              <button 
                onClick={createRoom}
                className="btn-green"
                disabled={!isConnected}
              >
                {isConnected ? 'Criar Sala' : '🔄 Conectando...'}
              </button>
            </div>

            {/* Entrar na Sala */}
            <div className="home-card">
              <h2>🚪 Entrar na Sala</h2>
              <input
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="home-input"
              />
              <input
                type="text"
                placeholder="Código (ex: X7K4P)"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="home-input"
                maxLength={5}
              />
              <button 
                onClick={joinRoom}
                className="btn-blue"
                disabled={!isConnected}
              >
                {isConnected ? 'Entrar na Sala' : '🔄 Conectando...'}
              </button>
            </div>
          </div>

          <div className="home-footer">
            <p>⚽ Jogo rápido sem cadastro. Monte seu time e vença!</p>
          </div>
        </div>
      </div>
    );
  }

  // ----- LOBBY -----
  if (view === 'lobby') {
    const isWaiting = gameState.players.length < 2;
    const isHost = gameState.player?.isHost;

    return (
      <div className="lobby-container">
        <div className="lobby-content">
          <div className="lobby-header">
            <button onClick={leaveRoom} className="btn-back">← Sair</button>
            <h2>⚽ Sala: {gameState.roomCode}</h2>
            <div className="lobby-code">{gameState.roomCode}</div>
          </div>

          <div className="lobby-players">
            <h3>👥 Jogadores</h3>
            <div className="players-list">
              {gameState.players.map((p, idx) => (
                <div key={p.id} className="player-item">
                  <span className="player-number">{idx + 1}</span>
                  <span className="player-name">{p.name}</span>
                  {p.isHost && <span className="player-host">👑</span>}
                  <span className="player-status">{p.isReady ? '✅' : '⏳'}</span>
                </div>
              ))}
              {Array.from({ length: 2 - gameState.players.length }).map((_, i) => (
                <div key={`empty-${i}`} className="player-item empty">
                  <span>⬜ Aguardando jogador...</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lobby-status">
            {isWaiting ? (
              <div className="status-waiting">
                <div className="loading-spinner"></div>
                <p>⏳ Aguardando adversário...</p>
                <p className="status-hint">Compartilhe o código com seu amigo!</p>
              </div>
            ) : (
              <div className="status-ready">
                <p>🎯 Ambos os jogadores estão prontos?</p>
                <button 
                  onClick={() => setView('game')}
                  className="btn-start"
                >
                  ENTRAR NO JOGO
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ----- GAME -----
  if (view === 'game') {
    const player = gameState.player;
    const isMyTurn = gameState.selection !== null && !gameState.isReady;
    const isTeamComplete = gameState.team.length >= 11;

    return (
      <div className="game-container">
        <div className="game-header">
          <button onClick={leaveRoom} className="btn-back">← Sair</button>
          <div className="game-room">Sala: {gameState.roomCode}</div>
          <div className="game-players">
            {gameState.players.map(p => (
              <span key={p.id} className={`game-player ${p.id === player?.id ? 'you' : 'opponent'}`}>
                {p.name} {p.isReady ? '✅' : '⏳'}
              </span>
            ))}
          </div>
        </div>

        <div className="game-body">
          {/* Coluna do oponente */}
          <div className="game-opponent">
            <h4>👤 {gameState.opponent?.playerName || 'Aguardando...'}</h4>
            <div className="opponent-team">
              {Array.from({ length: 11 }).map((_, i) => (
                <div key={i} className={`player-slot ${i < (gameState.opponent?.teamSize || 0) ? 'filled' : ''}`}>
                  {i < (gameState.opponent?.teamSize || 0) ? '⚽' : '⬜'}
                </div>
              ))}
            </div>
            <div className="opponent-info">
              <span>Trocas: {gameState.opponent?.swapsRemaining || 3}/3</span>
              <span>{gameState.opponent?.isReady ? '✅ Pronto' : '⏳ Montando...'}</span>
            </div>
          </div>

          {/* Área principal */}
          <div className="game-main">
            {/* Seleção da roleta */}
            {gameState.selection ? (
              <div className="selection-area">
                <div className="selection-header">
                  <span className="selection-flag">{gameState.selection.flag}</span>
                  <span className="selection-name">{gameState.selection.country} {gameState.selection.year}</span>
                  <button 
                    onClick={swapSelection}
                    className="btn-swap"
                    disabled={gameState.swapsRemaining <= 0}
                  >
                    🔄 Trocas: {gameState.swapsRemaining}/3
                  </button>
                </div>
                <div className="players-grid">
                  {gameState.selection.players.map(player => (
                    <div 
                      key={player.id}
                      className="player-card"
                      onClick={() => selectPlayer(player.id)}
                    >
                      <div className="player-card-name">{player.name}</div>
                      <div className="player-card-pos">{player.position}</div>
                      <div className="player-card-rating">{player.rating}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="action-area">
                <button 
                  onClick={spinRoulette}
                  className="btn-spin"
                  disabled={isTeamComplete || gameState.isReady}
                >
                  🎰 GIRAR ROLETA
                </button>
                {isTeamComplete && (
                  <div className="team-complete">✅ Time completo! {gameState.isReady ? 'Pronto!' : 'Aguardando...'}</div>
                )}
                {gameState.isReady && (
                  <div className="ready-status">✅ Você está pronto! Aguardando o oponente...</div>
                )}
              </div>
            )}

            {/* Meu time */}
            <div className="my-team">
              <h4>⚽ Meu Time ({gameState.team.length}/11)</h4>
              <div className="team-grid">
                {gameState.team.map((p, i) => (
                  <div key={i} className="team-player">
                    <span className="tp-name">{p.name}</span>
                    <span className="tp-rating">{p.rating}</span>
                    <span className="tp-pos">{p.position}</span>
                  </div>
                ))}
                {Array.from({ length: 11 - gameState.team.length }).map((_, i) => (
                  <div key={`empty-${i}`} className="team-player empty">⬜</div>
                ))}
              </div>
              <div className="team-info">
                <span>Trocas: {gameState.swapsRemaining}/3</span>
                <span>{gameState.isReady ? '✅ Pronto' : '⏳ Montando...'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Botão de confirmar */}
        {isTeamComplete && !gameState.isReady && (
          <div className="confirm-area">
            <button 
              onClick={() => {
                // Marca como pronto
                setGameState(prev => ({ ...prev, isReady: true }));
                // Notifica o servidor
                socket.emit('player-ready', {
                  roomCode: gameState.roomCode,
                  playerId: gameState.player.id
                });
              }}
              className="btn-confirm"
            >
              ✅ CONFIRMAR TIME
            </button>
          </div>
        )}

        {/* Botão iniciar partida (host) */}
        {gameState.matchStatus === 'ready' && gameState.player?.isHost && (
          <div className="start-area">
            <button onClick={startMatch} className="btn-match-start">
              🏆 INICIAR PARTIDA
            </button>
          </div>
        )}
      </div>
    );
  }

  // ----- RESULT -----
  if (view === 'result') {
    const result = gameState.matchResult;
    if (!result) return <div>Carregando...</div>;

    const isWinner = result.winner === 'team1' 
      ? gameState.player?.id === result.player1.id
      : result.winner === 'team2'
      ? gameState.player?.id === result.player2.id
      : false;

    return (
      <div className="result-container">
        <div className="result-content">
          <div className="result-header">
            <h1>🏆 FIM DE JOGO</h1>
            <div className="result-score">
              <span className="result-team">{result.player1.name}</span>
              <span className="result-score-value">{result.team1Score} x {result.team2Score}</span>
              <span className="result-team">{result.player2.name}</span>
            </div>
          </div>

          <div className={`result-winner ${isWinner ? 'winner' : 'loser'}`}>
            {isWinner ? '🏆 VOCÊ VENCEU!' : result.winner === 'draw' ? '🤝 EMPATE!' : '😔 VOCÊ PERDEU!'}
          </div>

          <div className="result-stats">
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Gols</span>
                <span className="stat-value">{result.team1Score}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Finalização</span>
                <span className="stat-value">{result.stats.team1.shots}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Posse</span>
                <span className="stat-value">{result.stats.team1.possession}%</span>
              </div>
            </div>
            <div className="vs">VS</div>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Gols</span>
                <span className="stat-value">{result.team2Score}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Finalização</span>
                <span className="stat-value">{result.stats.team2.shots}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Posse</span>
                <span className="stat-value">{result.stats.team2.possession}%</span>
              </div>
            </div>
          </div>

          <div className="result-events">
            <h3>⚽ Gols da Partida</h3>
            {gameState.matchEvents.map((event, i) => (
              <div key={i} className="event-item">
                <span className="event-minute">{event.minute}'</span>
                <span className="event-scorer">{event.scorer}</span>
                <span className="event-score">{event.score}</span>
              </div>
            ))}
          </div>

          <div className="result-actions">
            <button onClick={playAgain} className="btn-play-again">🔄 Jogar Novamente</button>
            <button onClick={() => {
              leaveRoom();
              setView('home');
            }} className="btn-menu">🏠 Menu</button>
          </div>
        </div>
      </div>
    );
  }

  return <div>Carregando...</div>;
}

export default App;
