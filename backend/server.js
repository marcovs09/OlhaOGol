// ============================================================
// SERVIDOR PRINCIPAL - OLHAOGOL
// ============================================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { worldCupData, getRandomTeam } from './src/data/worldCups.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Configuração do Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// ============================================================
// ARMAZENAMENTO EM MEMÓRIA
// ============================================================

const rooms = {};

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

// Gera código aleatório de 5 caracteres
const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Calcula força do time
const calculateTeamStrength = (team) => {
  if (!team || team.length === 0) return 0;
  
  let totalRating = 0;
  let positionCounts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  
  team.forEach(player => {
    totalRating += player.rating || 70;
    if (player.position) {
      positionCounts[player.position] = (positionCounts[player.position] || 0) + 1;
    }
  });
  
  const avgRating = totalRating / team.length;
  
  // Bônus por formação equilibrada
  let bonus = 0;
  if (positionCounts.GK >= 1) bonus += 5;
  if (positionCounts.DEF >= 3) bonus += 5;
  if (positionCounts.MID >= 3) bonus += 5;
  if (positionCounts.ATT >= 2) bonus += 5;
  
  return avgRating + bonus;
};

// Simula partida entre dois times
const simulateMatch = (team1, team2, player1Name, player2Name) => {
  const strength1 = calculateTeamStrength(team1);
  const strength2 = calculateTeamStrength(team2);
  
  const totalStrength = strength1 + strength2;
  const probGoal1 = strength1 / totalStrength;
  const probGoal2 = strength2 / totalStrength;
  
  // Número total de gols (2-6)
  const totalGoals = Math.floor(Math.random() * 5) + 2;
  const events = [];
  let score1 = 0, score2 = 0;
  
  for (let i = 0; i < totalGoals; i++) {
    const minute = Math.floor(Math.random() * 85) + 5;
    const rng = Math.random();
    
    if (rng < probGoal1) {
      score1++;
      const scorer = team1[Math.floor(Math.random() * team1.length)];
      events.push({
        minute,
        type: 'goal',
        team: 'team1',
        scorer: scorer.name,
        playerName: player1Name,
        score: `${score1}x${score2}`
      });
    } else {
      score2++;
      const scorer = team2[Math.floor(Math.random() * team2.length)];
      events.push({
        minute,
        type: 'goal',
        team: 'team2',
        scorer: scorer.name,
        playerName: player2Name,
        score: `${score1}x${score2}`
      });
    }
  }
  
  events.sort((a, b) => a.minute - b.minute);
  
  return {
    events,
    score: `${score1}x${score2}`,
    winner: score1 > score2 ? 'team1' : (score2 > score1 ? 'team2' : 'draw'),
    team1Score: score1,
    team2Score: score2,
    stats: {
      team1: {
        goals: score1,
        shots: Math.floor(score1 * 3.5) + Math.floor(Math.random() * 5) + 5,
        possession: 40 + Math.floor(Math.random() * 30)
      },
      team2: {
        goals: score2,
        shots: Math.floor(score2 * 3.5) + Math.floor(Math.random() * 5) + 5,
        possession: 40 + Math.floor(Math.random() * 30)
      }
    }
  };
};

// ============================================================
// ROTAS HTTP
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    rooms: Object.keys(rooms).length
  });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Object.keys(rooms).map(code => ({
    code,
    players: rooms[code].players.map(p => p.name),
    status: rooms[code].status
  }));
  res.json(roomList);
});

// ============================================================
// WEBSOCKET - EVENTOS
// ============================================================

io.on('connection', (socket) => {
  console.log(`✅ Jogador conectou: ${socket.id}`);

  // ----------------------------------------------------------
  // CRIAR SALA
  // ----------------------------------------------------------
  socket.on('create-room', (data) => {
    try {
      const { playerName } = data;
      
      if (!playerName || playerName.trim() === '') {
        socket.emit('error', { message: 'Nome do jogador é obrigatório' });
        return;
      }
      
      const code = generateRoomCode();
      
      rooms[code] = {
        code: code,
        players: [
          {
            id: socket.id,
            name: playerName.trim(),
            team: [],
            swapsRemaining: 3,
            isReady: false,
            isHost: true
          }
        ],
        status: 'waiting', // waiting | drafting | ready | playing | finished
        createdAt: Date.now(),
        lastActivity: Date.now(),
        matchResult: null,
        currentSelection: null
      };
      
      socket.join(code);
      
      socket.emit('room-created', {
        roomCode: code,
        player: rooms[code].players[0],
        players: rooms[code].players.map(p => ({
          id: p.id,
          name: p.name,
          isHost: p.isHost
        }))
      });
      
      console.log(`🏠 Sala ${code} criada por ${playerName}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ----------------------------------------------------------
  // ENTRAR NA SALA
  // ----------------------------------------------------------
  socket.on('join-room', (data) => {
    try {
      const { roomCode, playerName } = data;
      
      if (!roomCode || !playerName || playerName.trim() === '') {
        socket.emit('error', { message: 'Dados inválidos' });
        return;
      }
      
      const code = roomCode.toUpperCase();
      const room = rooms[code];
      
      if (!room) {
        socket.emit('error', { message: '❌ Sala não encontrada!' });
        return;
      }
      
      if (room.players.length >= 2) {
        socket.emit('error', { message: '❌ Sala já está cheia!' });
        return;
      }
      
      if (room.status !== 'waiting' && room.status !== 'drafting') {
        socket.emit('error', { message: '❌ Partida já em andamento!' });
        return;
      }
      
      const player = {
        id: socket.id,
        name: playerName.trim(),
        team: [],
        swapsRemaining: 3,
        isReady: false,
        isHost: false
      };
      
      room.players.push(player);
      room.status = 'drafting';
      room.lastActivity = Date.now();
      
      socket.join(code);
      
      socket.emit('room-joined', {
        roomCode: code,
        player: player,
        players: room.players.map(p => ({
          id: p.id,
          name: p.name,
          isHost: p.isHost
        }))
      });
      
      // Avisa o primeiro jogador
      socket.to(code).emit('player-joined', {
        players: room.players.map(p => ({
          id: p.id,
          name: p.name,
          isHost: p.isHost
        }))
      });
      
      console.log(`🚪 ${playerName} entrou na sala ${code}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ----------------------------------------------------------
  // GIRAR ROLETA
  // ----------------------------------------------------------
  socket.on('spin-roulette', (data) => {
    try {
      const { roomCode, playerId } = data;
      const room = rooms[roomCode];
      
      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }
      
      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('error', { message: 'Jogador não encontrado' });
        return;
      }
      
      if (player.team.length >= 11) {
        socket.emit('error', { message: 'Time já está completo!' });
        return;
      }
      
      // Pega um time aleatório
      const selection = getRandomTeam();
      
      room.currentSelection = {
        playerId: playerId,
        selection: selection
      };
      
      socket.emit('roulette-spun', {
        playerId: playerId,
        selection: selection
      });
      
      console.log(`🎰 Roleta girada para ${player.name} na sala ${roomCode}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ----------------------------------------------------------
  // SELECIONAR JOGADOR
  // ----------------------------------------------------------
  socket.on('select-player', (data) => {
    try {
      const { roomCode, playerId, playerCardId, position } = data;
      const room = rooms[roomCode];
      
      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }
      
      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('error', { message: 'Jogador não encontrado' });
        return;
      }
      
      if (!room.currentSelection || room.currentSelection.playerId !== playerId) {
        socket.emit('error', { message: 'Nenhuma seleção ativa' });
        return;
      }
      
      const selection = room.currentSelection.selection;
      const selectedPlayer = selection.players.find(p => p.id === playerCardId);
      
      if (!selectedPlayer) {
        socket.emit('error', { message: 'Jogador não encontrado na seleção' });
        return;
      }
      
      // Adiciona ao time
      const newPlayer = {
        ...selectedPlayer,
        country: selection.country,
        year: selection.year,
        fieldPosition: position || 'MID'
      };
      
      player.team.push(newPlayer);
      room.currentSelection = null;
      room.lastActivity = Date.now();
      
      // Verifica se completou o time
      if (player.team.length >= 11) {
        player.isReady = true;
      }
      
      socket.emit('player-selected', {
        player: newPlayer,
        teamSize: player.team.length,
        isReady: player.isReady
      });
      
      // Notifica oponente
      const opponent = room.players.find(p => p.id !== playerId);
      if (opponent) {
        io.to(roomCode).emit('opponent-update', {
          playerId: playerId,
          playerName: player.name,
          teamSize: player.team.length,
          isReady: player.isReady,
          swapsRemaining: player.swapsRemaining
        });
      }
      
      console.log(`⚽ ${player.name} selecionou ${selectedPlayer.name} na sala ${roomCode}`);
      
      // Verifica se ambos estão prontos
      const allReady = room.players.every(p => p.isReady && p.team.length >= 11);
      if (allReady && room.players.length === 2) {
        room.status = 'ready';
        io.to(roomCode).emit('match-ready', {
          players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            team: p.team
          }))
        });
        console.log(`🎯 Partida pronta na sala ${roomCode}!`);
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ----------------------------------------------------------
  // TROCAR SELEÇÃO
  // ----------------------------------------------------------
  socket.on('swap-selection', (data) => {
    try {
      const { roomCode, playerId } = data;
      const room = rooms[roomCode];
      
      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }
      
      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('error', { message: 'Jogador não encontrado' });
        return;
      }
      
      if (player.swapsRemaining <= 0) {
        socket.emit('error', { message: 'Sem trocas disponíveis!' });
        return;
      }
      
      if (!room.currentSelection || room.currentSelection.playerId !== playerId) {
        socket.emit('error', { message: 'Nenhuma seleção ativa para trocar' });
        return;
      }
      
      player.swapsRemaining--;
      room.currentSelection = null;
      room.lastActivity = Date.now();
      
      socket.emit('swap-used', {
        swapsRemaining: player.swapsRemaining
      });
      
      // Notifica oponente
      const opponent = room.players.find(p => p.id !== playerId);
      if (opponent) {
        io.to(roomCode).emit('opponent-update', {
          playerId: playerId,
          playerName: player.name,
          swapsRemaining: player.swapsRemaining
        });
      }
      
      console.log(`🔄 ${player.name} usou uma troca na sala ${roomCode}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ----------------------------------------------------------
  // INICIAR PARTIDA
  // ----------------------------------------------------------
  socket.on('start-match', (data) => {
    try {
      const { roomCode } = data;
      const room = rooms[roomCode];
      
      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }
      
      if (room.status !== 'ready') {
        socket.emit('error', { message: 'Partida não está pronta' });
        return;
      }
      
      if (room.players.length !== 2) {
        socket.emit('error', { message: 'Precisa de 2 jogadores' });
        return;
      }
      
      room.status = 'playing';
      
      const player1 = room.players[0];
      const player2 = room.players[1];
      
      // Simula a partida
      const result = simulateMatch(
        player1.team,
        player2.team,
        player1.name,
        player2.name
      );
      
      room.matchResult = {
        ...result,
        player1: {
          id: player1.id,
          name: player1.name,
          team: player1.team
        },
        player2: {
          id: player2.id,
          name: player2.name,
          team: player2.team
        }
      };
      
      // Envia os eventos um por um (com delay para animação)
      let eventIndex = 0;
      
      const sendNextEvent = () => {
        if (eventIndex < result.events.length) {
          const event = result.events[eventIndex];
          io.to(roomCode).emit('match-event', event);
          eventIndex++;
          setTimeout(sendNextEvent, 1500);
        } else {
          // Partida terminada
          room.status = 'finished';
          io.to(roomCode).emit('match-ended', {
            result: room.matchResult
          });
          console.log(`🏆 Partida finalizada na sala ${roomCode}`);
        }
      };
      
      io.to(roomCode).emit('match-starting', {
        player1: {
          name: player1.name,
          team: player1.team
        },
        player2: {
          name: player2.name,
          team: player2.team
        }
      });
      
      setTimeout(sendNextEvent, 2000);
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ----------------------------------------------------------
  // JOGAR NOVAMENTE
  // ----------------------------------------------------------
  socket.on('play-again', (data) => {
    try {
      const { roomCode } = data;
      const room = rooms[roomCode];
      
      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }
      
      // Reseta o estado da partida
      room.players.forEach(p => {
        p.team = [];
        p.swapsRemaining = 3;
        p.isReady = false;
      });
      
      room.status = 'drafting';
      room.matchResult = null;
      room.currentSelection = null;
      room.lastActivity = Date.now();
      
      io.to(roomCode).emit('reset-game', {
        players: room.players.map(p => ({
          id: p.id,
          name: p.name
        }))
      });
      
      console.log(`🔄 Sala ${roomCode} reiniciada`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ----------------------------------------------------------
  // SAIR DA SALA
  // ----------------------------------------------------------
  socket.on('leave-room', (data) => {
    try {
      const { roomCode, playerId } = data;
      const room = rooms[roomCode];
      
      if (!room) return;
      
      socket.leave(roomCode);
      
      room.players = room.players.filter(p => p.id !== playerId);
      
      if (room.players.length === 0) {
        delete rooms[roomCode];
        console.log(`🗑️ Sala ${roomCode} removida (vazia)`);
      } else {
        io.to(roomCode).emit('player-left', {
          playerId: playerId,
          players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost
          }))
        });
        room.status = 'waiting';
        room.lastActivity = Date.now();
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ----------------------------------------------------------
  // DESCONECTAR
  // ----------------------------------------------------------
  socket.on('disconnect', () => {
    console.log(`❌ Jogador desconectou: ${socket.id}`);
    
    for (const code in rooms) {
      const room = rooms[code];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);
        
        if (room.players.length === 0) {
          delete rooms[code];
          console.log(`🗑️ Sala ${code} removida (jogador desconectou)`);
        } else {
          io.to(code).emit('player-left', {
            playerId: socket.id,
            players: room.players.map(p => ({
              id: p.id,
              name: p.name,
              isHost: p.isHost
            }))
          });
          
          if (room.status === 'playing' || room.status === 'ready') {
            room.status = 'waiting';
            io.to(code).emit('match-abandoned', {
              message: `${playerName} abandonou a partida`
            });
          }
        }
      }
    }
  });

});

// ============================================================
// LIMPEZA DE SALAS INATIVAS (a cada 5 minutos)
// ============================================================

setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutos
  
  for (const code in rooms) {
    const room = rooms[code];
    if (now - room.lastActivity > timeout) {
      delete rooms[code];
      console.log(`🧹 Sala ${code} removida (inativa)`);
    }
  }
}, 5 * 60 * 1000);

// ============================================================
// INICIA O SERVIDOR
// ============================================================

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor OlhaOGol rodando em http://localhost:${PORT}`);
  console.log(`📊 Salas ativas: 0`);
});

// Tratamento de erros
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não tratado:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Promessa rejeitada:', error);
});
