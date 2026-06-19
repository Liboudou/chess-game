/**
 * app.js — Chess Game UI Controller
 *
 * Depends on: chess.js (Chess), evaluation.js (window.evaluate),
 *             ai.js (window.findBestMove, window.getScore)
 */

/* ─── Unicode piece symbols ─────────────────────────────────────── */
const UNICODE_PIECES = {
  K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F',
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F',
};

// PIECE_VALUES for captured piece ordering (centipawn-style).
// evaluation.js also declares const PIECE_VALUES — we use it directly.
// Note: evaluation.js values are in centipawns (P=100), app.js needs simple 1-9 ordering.
// We define under a different name to avoid redeclaration conflict.
const PIECE_VALUE_ORDER = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0, p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/* ─── State ─────────────────────────────────────────────────────── */
let game = new Chess();
let selectedSquare = null;
let legalMovesForSelected = [];
let gameMode = '1v1';
let aiDepth = 3;
let aiThinking = false;
let showEvalBar = true;
let capturedWhite = [];
let capturedBlack = [];
let moveStack = [];
let isPromoting = false;
let pendingPromotion = null;
let lastMove = null;
let moveCount = 0;
let historyEntries = [];

/* ─── Analysis mode state ───────────────────────────────────────── */
let analysisMode = false;
let analysisPosition = 0;  // index into analysisHistory
let analysisHistory = [];  // [{ fen, move, notation, eval }]
let analysisGame = null;   // temporary Chess instance for navigating
let analysisScore = 0;
let analysisBestMove = null; // best move arrow for current position
let gameOverAtMove = false;

/* ─── DOM references ────────────────────────────────────────────── */
const boardEl = document.getElementById('chess-board');
const statusEl = document.getElementById('game-status');
const turnLabel = document.getElementById('turn-label');
const turnDot = document.getElementById('turn-dot');
const moveHistoryEl = document.getElementById('move-history');
const capturedWhiteEl = document.getElementById('captured-white');
const capturedBlackEl = document.getElementById('captured-black');
const evalBarContainer = document.getElementById('eval-bar-container');
const evalScore = document.getElementById('eval-score');
const promoOverlay = document.getElementById('promotion-overlay');
const promoOptions = document.getElementById('promo-options');
const aiThinkingEl = document.getElementById('ai-thinking');
const rankLabels = document.getElementById('rank-labels');
const fileLabels = document.getElementById('file-labels');
const analysisPanel = document.getElementById('analysis-panel');
const canvasEl = document.getElementById('best-move-canvas');

// Helper: safe DOM ref
function el(id) { return document.getElementById(id); }

/* ─── Board rendering ───────────────────────────────────────────── */

function renderBoard() {
  boardEl.innerHTML = '';
  const board = analysisMode && analysisGame ? analysisGame.board : game.board;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = String.fromCharCode(97 + c) + (8 - r);
      const piece = board[r][c];
      const isLight = (r + c) % 2 === 0;
      const sqEl = document.createElement('div');
      sqEl.className = `square ${isLight ? 'light' : 'dark'}`;
      sqEl.dataset.square = sq;

      // Last move highlight
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
        sqEl.classList.add('last-move');
      }

      // Selected piece highlight
      if (sq === selectedSquare) {
        sqEl.classList.add('selected');
      }

      // Check highlight
      const currentGame = analysisMode && analysisGame ? analysisGame : game;
      if (piece.toUpperCase() === 'K' && currentGame.isCheck() &&
          ((currentGame.turn === 'w' && piece === 'K') || (currentGame.turn === 'b' && piece === 'k'))) {
        sqEl.classList.add('check');
      }

      // Legal move indicators (only when not in analysis mode)
      if (!analysisMode) {
        const legalMove = legalMovesForSelected.find(m => m.to === sq);
        if (legalMove) {
          if (board[r][c] !== '.') {
            const ring = document.createElement('div');
            ring.className = 'legal-capture-ring';
            sqEl.appendChild(ring);
          } else {
            const dot = document.createElement('div');
            dot.className = 'legal-dot';
            sqEl.appendChild(dot);
          }
        }
      }

      // Piece
      if (piece !== '.') {
        const pieceEl = document.createElement('span');
        pieceEl.className = 'piece';
        pieceEl.classList.add(piece === piece.toUpperCase() ? 'piece-white' : 'piece-black');
        pieceEl.textContent = UNICODE_PIECES[piece] || piece;
        sqEl.appendChild(pieceEl);
      }

      sqEl.addEventListener('click', () => onSquareClick(sq));
      boardEl.appendChild(sqEl);
    }
  }

  // Draw best move arrow
  renderBestMoveArrow();
}

/* ─── Best move arrow (green arrow like chess.com) ──────────────── */

function renderBestMoveArrow() {
  const cvs = canvasEl;
  if (!cvs) return;
  const boardWrapper = document.querySelector('.board-wrapper');
  if (!boardWrapper) { cvs.style.display = 'none'; return; }

  const currentGame = analysisMode && analysisGame ? analysisGame : game;
  if (!analysisMode || !analysisBestMove) {
    cvs.style.display = 'none';
    return;
  }

  cvs.style.display = 'block';
  const rect = boardWrapper.getBoundingClientRect();
  cvs.width = rect.width;
  cvs.height = rect.height;

  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, cvs.width, cvs.height);

  const sqSize = cvs.width / 8;
  const fromRC = currentGame._sqToRC ? currentGame._sqToRC(analysisBestMove.from) : { r: 0, c: 0 };
  const toRC = currentGame._sqToRC ? currentGame._sqToRC(analysisBestMove.to) : { r: 7, c: 7 };

  // Center of from and to squares (y is inverted for canvas)
  const fromX = fromRC.c * sqSize + sqSize / 2;
  const fromY = fromRC.r * sqSize + sqSize / 2;
  const toX = toRC.c * sqSize + sqSize / 2;
  const toY = toRC.r * sqSize + sqSize / 2;

  const angle = Math.atan2(toY - fromY, toX - fromX);
  const arrowLen = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
  // Shorten arrow so it doesn't overlap piece
  const shorten = sqSize * 0.35;
  const startX = fromX + Math.cos(angle) * shorten;
  const startY = fromY + Math.sin(angle) * shorten;
  const endX = toX - Math.cos(angle) * shorten;
  const endY = toY - Math.sin(angle) * shorten;

  // Draw arrow line
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = 'rgba(76, 175, 80, 0.8)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Draw arrowhead
  const headLen = 14;
  const headAngle = Math.PI / 6;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - headLen * Math.cos(angle - headAngle), endY - headLen * Math.sin(angle - headAngle));
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - headLen * Math.cos(angle + headAngle), endY - headLen * Math.sin(angle + headAngle));
  ctx.strokeStyle = 'rgba(76, 175, 80, 0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();
}

/* ─── Click handling ────────────────────────────────────────────── */

function getPieceAt(sq) {
  if (analysisMode && analysisGame) {
    const rc = analysisGame._sqToRC ? analysisGame._sqToRC(sq) : game._sqToRC(sq);
    const board = analysisGame.board;
    return board[rc.r] ? board[rc.r][rc.c] : '.';
  }
  const rc = game._sqToRC(sq);
  const board = game.board;
  return board[rc.r] ? board[rc.r][rc.c] : '.';
}

function onSquareClick(sq) {
  // In analysis mode, clicking a square is disabled (no moves)
  if (analysisMode) return;

  if (game.isGameOver() || aiThinking || isPromoting) return;
  if (gameMode === 'ai' && game.turn === 'b') return;

  const rc = game._sqToRC(sq);
  const clickedPiece = game.board[rc.r][rc.c];

  // If we already have a selected piece and the click is a legal move target
  if (selectedSquare) {
    const move = legalMovesForSelected.find(m => m.to === sq);
    if (move) {
      if (move.flags && (move.flags.includes('p') || move.flags.includes('pc'))) {
        showPromotionDialog(move);
        return;
      }
      executeMove(move);
      return;
    }
  }

  // Select a piece
  if (clickedPiece !== '.') {
    const pieceColor = clickedPiece === clickedPiece.toUpperCase() ? 'w' : 'b';
    if (pieceColor === game.turn) {
      selectedSquare = sq;
      const allLegal = game.getLegalMoves();
      legalMovesForSelected = allLegal.filter(m => m.from === sq);
      renderBoard();
      return;
    }
  }

  clearSelection();
  renderBoard();
}

function clearSelection() {
  selectedSquare = null;
  legalMovesForSelected = [];
}

/* ─── Move execution ────────────────────────────────────────────── */

function executeMove(move) {
  const toRC = game._sqToRC(move.to);
  const capturedPiece = game.board[toRC.r][toRC.c];
  const isEnPassant = move.flags.includes('e');

  const undoState = {
    capturedWhiteDelta: [],
    capturedBlackDelta: [],
    lastMove: lastMove ? { ...lastMove } : null,
  };

  if (capturedPiece !== '.') {
    if (capturedPiece === capturedPiece.toUpperCase()) {
      undoState.capturedWhiteDelta.push(capturedPiece);
    } else {
      undoState.capturedBlackDelta.push(capturedPiece);
    }
  }

  if (isEnPassant) {
    const epR = game.turn === 'w' ? toRC.r + 1 : toRC.r - 1;
    const epPiece = game.board[epR][toRC.c];
    if (epPiece !== '.') {
      if (epPiece === epPiece.toUpperCase()) {
        undoState.capturedWhiteDelta.push(epPiece);
      } else {
        undoState.capturedBlackDelta.push(epPiece);
      }
    }
  }

  const fromRCForPiece = game._sqToRC(move.from);
  const movingPieceChar = game.board[fromRCForPiece.r][fromRCForPiece.c];

  const result = game.makeMove(move);
  if (!result) {
    clearSelection();
    renderBoard();
    return;
  }

  lastMove = { from: move.from, to: move.to };

  for (const p of undoState.capturedWhiteDelta) capturedWhite.push(p);
  for (const p of undoState.capturedBlackDelta) capturedBlack.push(p);

  const notation = moveToNotation(result, movingPieceChar);
  if (game.turn === 'w') {
    const num = Math.floor(moveCount / 2) + 1;
    if (historyEntries.length > 0 && !historyEntries[historyEntries.length - 1].black) {
      historyEntries[historyEntries.length - 1].black = notation;
    } else {
      historyEntries.push({ number: num, white: null, black: notation });
    }
  } else {
    const num = Math.floor(moveCount / 2) + 1;
    historyEntries.push({ number: num, white: notation, black: null });
  }
  moveCount++;

  moveStack.push(undoState);

  clearSelection();

  const afterMove = () => {
    updateUI();
    if (game.isGameOver()) {
      setTimeout(() => enterAnalysisMode(), 300);
    } else {
      checkAI();
    }
  };
  animatePieceMove(move.from, move.to, movingPieceChar, afterMove);
}

function moveToNotation(move, pieceChar) {
  const type = move.promotion ? move.promotion.toUpperCase() : '';

  if (move.flags.includes('k')) return 'O-O';
  if (move.flags.includes('q')) return 'O-O-O';

  const pieceType = pieceChar ? pieceChar.toUpperCase() : 'P';

  let n = '';
  if (pieceType !== 'P') n += pieceType;
  if (move.flags.includes('c') || move.flags.includes('e') || move.flags.includes('pc')) {
    if (pieceType === 'P') n += move.from[0];
    n += 'x';
  }
  n += move.to;
  if (move.promotion) n += '=' + move.promotion.toUpperCase();

  // Add check/mate symbol
  if (game.isCheckmate()) n += '#';
  else if (game.isCheck()) n += '+';

  return n;
}

/* ─── Undo ───────────────────────────────────────────────────────── */

function undoMove() {
  if (moveStack.length === 0 || aiThinking) return;

  // Exit analysis mode if active
  if (analysisMode) {
    exitAnalysisMode();
  }

  const state = moveStack.pop();
  game.undo();

  for (const p of state.capturedWhiteDelta) {
    const idx = capturedWhite.lastIndexOf(p);
    if (idx >= 0) capturedWhite.splice(idx, 1);
  }
  for (const p of state.capturedBlackDelta) {
    const idx = capturedBlack.lastIndexOf(p);
    if (idx >= 0) capturedBlack.splice(idx, 1);
  }

  moveCount--;

  // Fix undo: if the last entry has both white and black, just revert black notation
  if (historyEntries.length > 0 && historyEntries[historyEntries.length - 1].black !== null) {
    historyEntries[historyEntries.length - 1].black = null;
  } else {
    historyEntries.pop();
  }

  lastMove = state.lastMove;

  clearSelection();
  updateUI();
}

/* ─── Promotion dialog ──────────────────────────────────────────── */

function showPromotionDialog(move) {
  isPromoting = true;
  pendingPromotion = move;
  promoOptions.innerHTML = '';
  const color = game.turn;
  const promos = color === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];

  for (const p of promos) {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.textContent = UNICODE_PIECES[p] || p;
    btn.addEventListener('click', () => {
      move.promotion = p;
      if (move.flags.includes('pc')) {
        move.flags = 'pc';
      } else {
        move.flags = 'p';
      }
      promoOverlay.classList.remove('active');
      isPromoting = false;
      pendingPromotion = null;
      executeMove(move);
    });
    promoOptions.appendChild(btn);
  }

  promoOverlay.classList.add('active');
}

/* ─── AI ─────────────────────────────────────────────────────────── */

function checkAI() {
  if (gameMode !== 'ai') return;
  if (game.isGameOver()) return;
  if (game.turn === 'w') return;

  aiThinking = true;
  aiThinkingEl.classList.add('active');

  setTimeout(() => {
    const bestMove = findBestMove(game, aiDepth);

    if (bestMove) {
      executeMove(bestMove);
    }
    aiThinking = false;
    aiThinkingEl.classList.remove('active');
  }, 50);
}

/* ─── Evaluation bar ────────────────────────────────────────────── */

function updateEvalBar() {
  if (!showEvalBar) {
    evalBarContainer.classList.add('hidden');
    return;
  }
  evalBarContainer.classList.remove('hidden');

  const currentGame = analysisMode && analysisGame ? analysisGame : game;
  const score = evaluate(currentGame);
  const clamped = Math.max(-1000, Math.min(1000, score));
  const pct = 50 + (clamped / 20);
  const fillPct = Math.max(0, Math.min(100, pct));

  const whiteFill = document.getElementById('eval-fill-white');
  if (whiteFill) {
    whiteFill.style.height = fillPct + '%';
    whiteFill.style.width = fillPct + '%';
  }

  const displayScore = (score / 100).toFixed(1);
  evalScore.textContent = (score > 0 ? '+' : '') + displayScore;
}

/* ─── Piece slide animation ──────────────────────────────────────── */

function animatePieceMove(from, to, pieceChar, callback) {
  const boardWrapper = document.querySelector('.board-wrapper');
  if (!boardWrapper) { callback(); return; }

  const sqSize = boardWrapper.offsetWidth / 8;
  const fromFile = from.charCodeAt(0) - 97;
  const fromRank = 8 - parseInt(from[1]);
  const toFile = to.charCodeAt(0) - 97;
  const toRank = 8 - parseInt(to[1]);

  const pieceEl = document.createElement('span');
  pieceEl.className = 'floating-piece';
  pieceEl.textContent = UNICODE_PIECES[pieceChar] || pieceChar;
  pieceEl.style.left = (fromFile * sqSize) + 'px';
  pieceEl.style.top = (fromRank * sqSize) + 'px';
  pieceEl.style.width = sqSize + 'px';
  pieceEl.style.height = sqSize + 'px';
  pieceEl.style.fontSize = (sqSize * 0.8) + 'px';
  pieceEl.style.display = 'flex';
  pieceEl.style.alignItems = 'center';
  pieceEl.style.justifyContent = 'center';

  boardWrapper.appendChild(pieceEl);

  // Trigger reflow, then animate
  pieceEl.offsetHeight;
  pieceEl.style.left = (toFile * sqSize) + 'px';
  pieceEl.style.top = (toRank * sqSize) + 'px';

  pieceEl.addEventListener('transitionend', () => {
    pieceEl.remove();
    callback();
  }, { once: true });

  // Fallback if transitionend doesn't fire
  setTimeout(() => {
    if (pieceEl.parentNode) {
      pieceEl.remove();
      callback();
    }
  }, 400);
}

/* ─── Status & Info ─────────────────────────────────────────────── */

function updateStatus() {
  const t = game.turn === 'w' ? 'White' : 'Black';
  turnLabel.textContent = t + ' to move';
  turnDot.className = 'turn-dot ' + (game.turn === 'w' ? 'white' : 'black');

  if (game.isCheckmate()) {
    const winner = game.turn === 'w' ? 'Black' : 'White';
    statusEl.textContent = 'Checkmate! ' + winner + ' wins!';
    statusEl.className = 'game-status checkmate';
  } else if (game.isDraw()) {
    statusEl.textContent = 'Draw';
    statusEl.className = 'game-status draw';
  } else if (game.isCheck()) {
    statusEl.textContent = 'Check!';
    statusEl.className = 'game-status check';
  } else {
    statusEl.textContent = '';
    statusEl.className = 'game-status';
  }

  turnLabel.style.display = game.isGameOver() ? 'none' : '';
  turnDot.style.display = game.isGameOver() ? 'none' : '';

  // Show Analyze button when game is over and not already in analysis mode
  if (game.isGameOver() && !analysisMode && analysisPanel) {
    el('btn-analyze').style.display = '';
  }
}

/* ─── Move history (clickable in analysis mode) ─────────────────── */

function updateMoveHistory() {
  if (historyEntries.length === 0) {
    moveHistoryEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;">—</span>';
    return;
  }

  let html = '';
  for (let i = 0; i < historyEntries.length; i++) {
    const entry = historyEntries[i];
    const moveIndex = i * 2 + 1; // first half-move of this pair

    html += `<span class="move-number">${entry.number}.</span>`;
    if (entry.white) {
      const isCurrent = analysisMode && (analysisPosition === moveIndex);
      html += `<span class="move-pair${isCurrent ? ' current' : ''}${entry.black === null ? ' last' : ''}" data-move="${moveIndex}">${entry.white}</span> `;
    }
    if (entry.black) {
      const isCurrent = analysisMode && (analysisPosition === moveIndex + 1);
      html += `<span class="move-pair${isCurrent ? ' current' : ''}${entry.white === null ? ' last' : ''}" data-move="${moveIndex + 1}">${entry.black}</span> `;
    }
  }
  moveHistoryEl.innerHTML = html;
  moveHistoryEl.scrollTop = moveHistoryEl.scrollHeight;

  // Make moves clickable in analysis mode
  if (analysisMode) {
    moveHistoryEl.querySelectorAll('[data-move]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const pos = parseInt(el.dataset.move, 10);
        navigateToAnalysisPosition(pos);
      });
    });
  }
}

/* ─── Captured pieces ───────────────────────────────────────────── */

function updateCaptured() {
  const capturedWhiteSorted = [...capturedWhite].sort((a, b) => PIECE_VALUE_ORDER[b] - PIECE_VALUE_ORDER[a]);
  const cwValue = capturedWhiteSorted.reduce((sum, p) => sum + (PIECE_VALUE_ORDER[p] || 0), 0);

  const capturedBlackSorted = [...capturedBlack].sort((a, b) => PIECE_VALUE_ORDER[b] - PIECE_VALUE_ORDER[a]);
  const cbValue = capturedBlackSorted.reduce((sum, p) => sum + (PIECE_VALUE_ORDER[p] || 0), 0);

  capturedWhiteEl.innerHTML = capturedWhiteSorted.map(p =>
    `<span class="captured">${UNICODE_PIECES[p] || p}</span>`
  ).join('') + (cwValue > 0 ? `<span class="captured-value">+${cwValue}</span>` : '');

  capturedBlackEl.innerHTML = capturedBlackSorted.map(p =>
    `<span class="captured">${UNICODE_PIECES[p] || p}</span>`
  ).join('') + (cbValue > 0 ? `<span class="captured-value">+${cbValue}</span>` : '');
}

/* ─── Analysis mode ─────────────────────────────────────────────── */

function enterAnalysisMode() {
  if (!game.isGameOver()) return;
  if (historyEntries.length === 0) return;

  // Build analysis history from move stack
  rebuildAnalysisHistory();

  if (analysisHistory.length === 0) return;

  analysisMode = true;
  analysisGame = new Chess();
  analysisPosition = analysisHistory.length - 1; // start at last position
  gameOverAtMove = true;

  // Show analysis panel
  analysisPanel.style.display = '';
  el('btn-analyze').style.display = 'none';
  el('btn-exit-analysis').style.display = '';

  // Disable game mode buttons during analysis
  el('mode-1v1').disabled = true;
  el('mode-ai').disabled = true;
  el('btn-undo').disabled = true;

  // Set lastMove to highlight the last move
  if (analysisHistory.length > 0) {
    const lastEntry = analysisHistory[analysisHistory.length - 1];
    lastMove = lastEntry.moveRef ? { from: lastEntry.moveRef.from, to: lastEntry.moveRef.to } : null;
  }

  // Navigate to last position
  navigateToAnalysisPosition(analysisPosition);
}

function rebuildAnalysisHistory() {
  // Walk the game's internal _history to build FEN sequence
  const tempGame = new Chess();
  const gameHistory = game._history || [];

  analysisHistory = [];

  // Starting position
  analysisHistory.push({
    fen: tempGame.fen(),
    move: null,
    notation: null,
    moveRef: null,
    evalScore: evaluate(tempGame),
    bestMove: findBestMoveSafe(tempGame, aiDepth),
  });

  // Replay all moves from the game engine's history
  if (gameHistory.length > 0) {
    for (const state of gameHistory) {
      if (state.move) {
        const fromRC = tempGame._sqToRC(state.move.from);
        const movingPieceChar = tempGame.board[fromRC.r][fromRC.c];
        tempGame.makeMove(state.move);
        const evalScore = evaluate(tempGame);
        const bestMove = findBestMoveSafe(tempGame, aiDepth);
        const notation = moveToNotationFromGame(tempGame, state.move, movingPieceChar);
        analysisHistory.push({
          fen: tempGame.fen(),
          move: state.move,
          notation: notation,
          moveRef: { from: state.move.from, to: state.move.to },
          evalScore: evalScore,
          bestMove: bestMove,
        });
      }
    }
  } else {
    // Fallback: just use current position (no replay available)
    // This can happen if moves were made directly via chess engine API
    analysisHistory.push({
      fen: game.fen(),
      move: null,
      notation: null,
      moveRef: null,
      evalScore: evaluate(game),
      bestMove: findBestMoveSafe(game, aiDepth),
    });
  }
}

function moveToNotationFromGame(currentGame, move, pieceChar) {
  const isCheck = currentGame.isCheck();
  const isCheckmate = currentGame.isCheckmate();

  if (move.flags.includes('k')) return isCheckmate ? 'O-O#' : isCheck ? 'O-O+' : 'O-O';
  if (move.flags.includes('q')) return isCheckmate ? 'O-O-O#' : isCheck ? 'O-O-O+' : 'O-O-O';

  const pieceType = pieceChar ? pieceChar.toUpperCase() : 'P';

  let n = '';
  if (pieceType !== 'P') n += pieceType;
  if (move.flags.includes('c') || move.flags.includes('e') || move.flags.includes('pc')) {
    if (pieceType === 'P') n += move.from[0];
    n += 'x';
  }
  n += move.to;
  if (move.promotion) n += '=' + move.promotion.toUpperCase();
  if (isCheckmate) n += '#';
  else if (isCheck) n += '+';
  return n;
}

function findBestMoveSafe(gameInstance, depth) {
  try {
    if (gameInstance.isGameOver()) return null;
    return findBestMove(gameInstance, depth);
  } catch (e) {
    return null;
  }
}

function navigateToAnalysisPosition(pos) {
  if (!analysisMode || !analysisGame) return;
  if (pos < 0 || pos >= analysisHistory.length) return;

  analysisPosition = pos;
  const entry = analysisHistory[pos];

  // Load the FEN into analysisGame
  try {
    analysisGame.load(entry.fen);
  } catch (e) {
    return;
  }

  // Update lastMove for highlighting
  lastMove = entry.moveRef ? { from: entry.moveRef.from, to: entry.moveRef.to } : null;

  // Update analysis values
  analysisScore = entry.evalScore !== undefined ? entry.evalScore : 0;
  analysisBestMove = entry.bestMove || null;

  // Update the status for analysis mode
  updateAnalysisStatus(pos);

  // Update selected state
  selectedSquare = null;
  legalMovesForSelected = [];

  renderBoard();
  updateEvalBar();
  updateMoveHistory();
}

function updateAnalysisStatus(pos) {
  const entry = analysisHistory[pos];
  const totalMoves = analysisHistory.length - 1;
  const moveNum = Math.ceil(pos / 2);
  // Odd positions (1,3,5) = after white's move, even positions (2,4,6) = after black's move
  const side = (pos % 2 === 1) ? 'White' : 'Black';

  // Show current position
  let statusText = '';
  if (pos === 0) {
    statusText = 'Analysis: Starting position';
  } else {
    const notation = entry.notation || '...';
    statusText = `Analysis: Move ${moveNum} by ${side} — ${notation}`;
  }

  if (analysisBestMove) {
    statusText += ` | Best: ${analysisBestMove.from}→${analysisBestMove.to}`;
  }

  statusEl.textContent = statusText;
  statusEl.className = 'game-status';

  // Update navigation buttons
  el('btn-first').disabled = (pos <= 0);
  el('btn-prev').disabled = (pos <= 0);
  el('btn-next').disabled = (pos >= totalMoves);
  el('btn-last').disabled = (pos >= totalMoves);
}

function exitAnalysisMode() {
  analysisMode = false;
  analysisGame = null;
  analysisHistory = [];
  analysisPosition = 0;
  analysisBestMove = null;

  // Hide analysis panel
  if (analysisPanel) {
    analysisPanel.style.display = 'none';
    el('btn-analyze').style.display = '';
    el('btn-exit-analysis').style.display = 'none';
  }

  // Re-enable buttons
  el('mode-1v1').disabled = false;
  el('mode-ai').disabled = false;
  el('btn-undo').disabled = false;

  // Restore game state
  lastMove = moveStack.length > 0 ? moveStack[moveStack.length - 1].lastMove || null : null;

  clearSelection();
  updateUI();
  updateStatus();
}

function navigateAnalysis(delta) {
  if (!analysisMode) return;
  const newPos = analysisPosition + delta;
  if (newPos >= 0 && newPos < analysisHistory.length) {
    navigateToAnalysisPosition(newPos);
  }
}

/* ─── Full UI update ────────────────────────────────────────────── */

function updateUI() {
  renderBoard();
  updateEvalBar();
  updateStatus();
  updateMoveHistory();
  updateCaptured();
}

/* ─── New game ───────────────────────────────────────────────────── */

function newGame() {
  // Exit analysis if active
  if (analysisMode) {
    exitAnalysisMode();
  }

  game = new Chess();
  selectedSquare = null;
  legalMovesForSelected = [];
  capturedWhite = [];
  capturedBlack = [];
  moveStack = [];
  moveCount = 0;
  historyEntries = [];
  lastMove = null;
  aiThinking = false;
  isPromoting = false;
  pendingPromotion = null;
  promoOverlay.classList.remove('active');
  aiThinkingEl.classList.remove('active');

  // Reset analysis state
  analysisMode = false;
  analysisGame = null;
  analysisHistory = [];
  analysisPosition = 0;
  analysisBestMove = null;

  // Hide analysis panel
  if (analysisPanel) {
    analysisPanel.style.display = 'none';
    el('btn-analyze').style.display = '';
    el('btn-exit-analysis').style.display = 'none';
  }

  clearSelection();
  updateUI();

  // Re-enable buttons
  el('mode-1v1').disabled = false;
  el('mode-ai').disabled = false;
  el('btn-undo').disabled = false;
}

/* ─── Mode switching ────────────────────────────────────────────── */

function setMode(mode) {
  gameMode = mode;
  document.querySelectorAll('.mode-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'mode-' + mode);
  });
  el('difficulty-card').style.display = mode === 'ai' ? '' : 'none';

  if (mode === 'ai' && game.turn === 'b' && !game.isGameOver() && !aiThinking) {
    checkAI();
  }
}

/* ─── Init ───────────────────────────────────────────────────────── */

function init() {
  // Draw board
  newGame();

  // Button handlers
  el('btn-new-game').addEventListener('click', newGame);
  el('btn-undo').addEventListener('click', undoMove);
  el('mode-1v1').addEventListener('click', () => setMode('1v1'));
  el('mode-ai').addEventListener('click', () => setMode('ai'));

  // Difficulty selector
  document.querySelectorAll('.difficulty-selector button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.difficulty-selector button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      aiDepth = parseInt(btn.dataset.depth, 10);
    });
  });

  // Eval bar toggle
  el('eval-toggle').addEventListener('change', (e) => {
    showEvalBar = e.target.checked;
    updateEvalBar();
  });

  // Analysis navigation buttons
  el('btn-first').addEventListener('click', () => { if (analysisMode) navigateToAnalysisPosition(0); });
  el('btn-prev').addEventListener('click', () => navigateAnalysis(-1));
  el('btn-next').addEventListener('click', () => navigateAnalysis(1));
  el('btn-last').addEventListener('click', () => { if (analysisMode) navigateToAnalysisPosition(analysisHistory.length - 1); });
  el('btn-analyze').addEventListener('click', enterAnalysisMode);
  el('btn-exit-analysis').addEventListener('click', exitAnalysisMode);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't interfere with text inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (analysisMode) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateAnalysis(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateAnalysis(1);
      }
      if (e.key === 'Home') {
        e.preventDefault();
        if (analysisMode) navigateToAnalysisPosition(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        if (analysisMode) navigateToAnalysisPosition(analysisHistory.length - 1);
      }
      if (e.key === 'Escape') {
        exitAnalysisMode();
      }
    }

    if (!analysisMode) {
      if (e.key === 'u' || e.key === 'z') {
        if (!e.ctrlKey && !e.metaKey) undoMove();
      }
      if (e.key === 'n') newGame();
    }
  });

  // Window resize handler for canvas
  if (canvasEl) {
    window.addEventListener('resize', () => {
      if (analysisMode) renderBoard();
    });
  }

  // ResizeObserver for canvas sizing
  const boardWrapper = document.querySelector('.board-wrapper');
  if (boardWrapper && canvasEl) {
    const ro = new ResizeObserver(() => {
      if (analysisMode) renderBoard();
    });
    ro.observe(boardWrapper);
  }

  console.log('Chess UI initialized');
}

// Export app functions to window for accessibility
window.app = {
  init: init,
  newGame: newGame,
  renderBoard: renderBoard,
  updateUI: updateUI,
  undoMove: undoMove,
  enterAnalysisMode: enterAnalysisMode,
  exitAnalysisMode: exitAnalysisMode,
  navigateAnalysis: navigateAnalysis,
};

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}