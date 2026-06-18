/**
 * app.js — Chess Game UI Controller
 *
 * Depends on: chess.js (Chess), evaluation.js (window.evaluate),
 *             ai.js (window.findBestMove, window.getScore)
 */

/* ─── Unicode piece symbols ─────────────────────────────────────── */
const UNICODE_PIECES = {
  K: '\u2654', Q: '\u2655', R: '\u2656', B: '\u2657', N: '\u2658', P: '\u2659',
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F',
};

const PIECE_VALUES = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0, p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/* ─── State ─────────────────────────────────────────────────────── */
let game = new Chess();
let selectedSquare = null;       // algebraic square string or null
let legalMovesForSelected = [];  // move objects
let gameMode = '1v1';           // '1v1' or 'ai'
let aiDepth = 3;
let aiThinking = false;
let showEvalBar = true;
let capturedWhite = [];  // pieces captured FROM white (white lost these)
let capturedBlack = [];  // pieces captured FROM black (black lost these)
let moveStack = [];      // history for undo: { capturedWhiteDelta, capturedBlackDelta }
let isPromoting = false;
let pendingPromotion = null; // { from, to }
let lastMove = null;     // { from, to } for highlighting

// Number of moves made (for move pair numbering)
let moveCount = 0;
let historyEntries = []; // [{ number, white, black }]

/* ─── DOM references ────────────────────────────────────────────── */
const boardEl = document.getElementById('chess-board');
const statusEl = document.getElementById('game-status');
const turnLabel = document.getElementById('turn-label');
const turnDot = document.getElementById('turn-dot');
const moveHistoryEl = document.getElementById('move-history');
const capturedWhiteEl = document.getElementById('captured-white');
const capturedBlackEl = document.getElementById('captured-black');
const evalBarContainer = document.getElementById('eval-bar-container');
const evalFill = document.getElementById('eval-fill');
const evalScore = document.getElementById('eval-score');
const promoOverlay = document.getElementById('promotion-overlay');
const promoOptions = document.getElementById('promo-options');
const aiThinkingEl = document.getElementById('ai-thinking');
const rankLabels = document.getElementById('rank-labels');
const fileLabels = document.getElementById('file-labels');

/* ─── Board rendering ───────────────────────────────────────────── */

function renderBoard() {
  boardEl.innerHTML = '';
  const board = game.board;

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
      if (piece.toUpperCase() === 'K' && game.isCheck() &&
          ((game.turn === 'w' && piece === 'K') || (game.turn === 'b' && piece === 'k'))) {
        sqEl.classList.add('check');
      }

      // Legal move indicators
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

      // Piece
      if (piece !== '.') {
        const pieceEl = document.createElement('span');
        pieceEl.className = 'piece';
        pieceEl.textContent = UNICODE_PIECES[piece] || piece;
        sqEl.appendChild(pieceEl);
      }

      sqEl.addEventListener('click', () => onSquareClick(sq));
      boardEl.appendChild(sqEl);
    }
  }
}

/* ─── Click handling ────────────────────────────────────────────── */

function onSquareClick(sq) {
  if (game.isGameOver() || aiThinking || isPromoting) return;
  if (gameMode === 'ai' && game.turn === 'b') return; // AI's turn

  const clickedPiece = game.board[game._sqToRC(sq).r][game._sqToRC(sq).c];

  // If we already have a selected piece and the click is a legal move target
  if (selectedSquare) {
    const move = legalMovesForSelected.find(m => m.to === sq);
    if (move) {
      // If pawn promotion and move is a promotion (has p/pc flag)
      if (move.flags && (move.flags.includes('p') || move.flags.includes('pc'))) {
        showPromotionDialog(move);
        return;
      }
      executeMove(move);
      return;
    }
  }

  // Select a piece (if any piece of current turn exists at this square)
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

  // Click on empty square or enemy piece without a selected piece → deselect
  clearSelection();
  renderBoard();
}

function clearSelection() {
  selectedSquare = null;
  legalMovesForSelected = [];
}

/* ─── Move execution ────────────────────────────────────────────── */

function executeMove(move) {
  // Track captured piece before making the move
  const toRC = game._sqToRC(move.to);
  const capturedPiece = game.board[toRC.r][toRC.c];
  const isEnPassant = move.flags.includes('e');
  const isCastle = move.flags.includes('k') || move.flags.includes('q');

  // Save undo state (including lastMove for proper undo highlighting)
  const undoState = {
    capturedWhiteDelta: [],
    capturedBlackDelta: [],
    lastMove: lastMove ? { ...lastMove } : null,
  };

  if (capturedPiece !== '.') {
    if (capturedPiece === capturedPiece.toUpperCase()) {
      // White piece captured
      undoState.capturedWhiteDelta.push(capturedPiece);
    } else {
      undoState.capturedBlackDelta.push(capturedPiece);
    }
  }

  // En passant: the captured pawn is on a different square
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

  const result = game.makeMove(move);
  if (!result) {
    clearSelection();
    renderBoard();
    return;
  }

  // Track the last move
  lastMove = { from: move.from, to: move.to };

  // Update captured pieces
  for (const p of undoState.capturedWhiteDelta) capturedWhite.push(p);
  for (const p of undoState.capturedBlackDelta) capturedBlack.push(p);

  // Track move for history
  const notation = moveToNotation(result);
  if (game.turn === 'w') {
    // Black just moved - this is a complete pair
    const num = moveCount + 1;
    if (historyEntries.length > 0 && !historyEntries[historyEntries.length - 1].black) {
      historyEntries[historyEntries.length - 1].black = notation;
    } else {
      historyEntries.push({ number: num, white: null, black: notation });
    }
  } else {
    // White just moved
    const num = moveCount + 1;
    historyEntries.push({ number: num, white: notation, black: null });
  }
  moveCount++;

  moveStack.push(undoState);

  // Re-set: the move may have been a castling or promotion, so get the result move
  clearSelection();
  updateUI();
  checkAI();
}

function moveToNotation(move) {
  const type = move.promotion ? move.promotion.toUpperCase() : '';

  if (move.flags.includes('k')) return 'O-O';
  if (move.flags.includes('q')) return 'O-O-O';

  // Determine piece type from the moving piece
  // In the current state (after makeMove), we look at the target square
  const toRC = game._sqToRC(move.to);
  const pieceOnTarget = game.board[toRC.r][toRC.c];
  const pieceType = pieceOnTarget !== '.' ? pieceOnTarget.toUpperCase() : 'P';

  let n = '';
  if (pieceType !== 'P') n += pieceType;
  if (move.flags.includes('c') || move.flags.includes('e') || move.flags.includes('pc')) {
    if (pieceType === 'P') n += move.from[0];
    n += 'x';
  }
  n += move.to;
  if (move.promotion) n += '=' + move.promotion.toUpperCase();
  return n;
}

/* ─── Undo ───────────────────────────────────────────────────────── */

function undoMove() {
  if (moveStack.length === 0 || aiThinking) return;

  const state = moveStack.pop();
  game.undo();

  // Restore captured pieces
  for (const p of state.capturedWhiteDelta) {
    const idx = capturedWhite.lastIndexOf(p);
    if (idx >= 0) capturedWhite.splice(idx, 1);
  }
  for (const p of state.capturedBlackDelta) {
    const idx = capturedBlack.lastIndexOf(p);
    if (idx >= 0) capturedBlack.splice(idx, 1);
  }

  moveCount--;
  historyEntries.pop();
  // Restore the lastMove from saved undo state: the move we're undoing becomes
  // the highlight target, and the one before it was saved in state.lastMove.
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
        move.flags = 'pc'; // keep promotion+capture flag
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
  if (game.turn === 'w') return; // White is human

  aiThinking = true;
  aiThinkingEl.classList.add('active');

  setTimeout(() => {
    const boardCopy = game.board.map(row => [...row]);
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

  const score = evaluate(game);
  // Clamp score to [-1000, 1000] for display
  const clamped = Math.max(-1000, Math.min(1000, score));
  // Map score to fill percentage: 0cp = 50%, +1000cp = 100%, -1000cp = 0%
  const pct = 50 + (clamped / 20);
  const fillPct = Math.max(0, Math.min(100, pct));

  evalFill.className = 'eval-fill';
  if (score > 0) {
    evalFill.classList.add('white-advantage');
    evalFill.style.height = fillPct + '%';
  } else {
    evalFill.classList.add('black-advantage');
    evalFill.style.height = (100 - fillPct) + '%';
  }

  // Display score
  const displayScore = score.toFixed(1);
  evalScore.textContent = (score > 0 ? '+' : '') + displayScore;
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

  // Update turn indicator visibility
  turnLabel.style.display = game.isGameOver() ? 'none' : '';
  turnDot.style.display = game.isGameOver() ? 'none' : '';
}

/* ─── Move history ──────────────────────────────────────────────── */

function updateMoveHistory() {
  if (historyEntries.length === 0) {
    moveHistoryEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;">—</span>';
    return;
  }

  let html = '';
  for (const entry of historyEntries) {
    html += `<span class="move-number">${entry.number}.</span>`;
    if (entry.white) {
      html += `<span class="move-pair${entry.black === null ? ' last' : ''}">${entry.white}</span>`;
    }
    if (entry.black) {
      html += `<span class="move-pair${entry.white === null ? ' last' : ''}">${entry.black}</span> `;
    }
  }
  moveHistoryEl.innerHTML = html;
  moveHistoryEl.scrollTop = moveHistoryEl.scrollHeight;
}

/* ─── Captured pieces ───────────────────────────────────────────── */

function updateCaptured() {
  // Pieces captured from white (white lost these) — shown on white's side
  const capturedWhiteSorted = [...capturedWhite].sort((a, b) => PIECE_VALUES[b] - PIECE_VALUES[a]);
  const cwValue = capturedWhiteSorted.reduce((sum, p) => sum + (PIECE_VALUES[p] || 0), 0);

  // Pieces captured from black (black lost these) — shown on black's side
  const capturedBlackSorted = [...capturedBlack].sort((a, b) => PIECE_VALUES[b] - PIECE_VALUES[a]);
  const cbValue = capturedBlackSorted.reduce((sum, p) => sum + (PIECE_VALUES[p] || 0), 0);

  capturedWhiteEl.innerHTML = capturedWhiteSorted.map(p =>
    `<span class="captured">${UNICODE_PIECES[p] || p}</span>`
  ).join('') + (cwValue > 0 ? `<span class="captured-value">+${cwValue}</span>` : '');

  capturedBlackEl.innerHTML = capturedBlackSorted.map(p =>
    `<span class="captured">${UNICODE_PIECES[p] || p}</span>`
  ).join('') + (cbValue > 0 ? `<span class="captured-value">+${cbValue}</span>` : '');
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
  clearSelection();
  updateUI();
}

/* ─── Mode switching ────────────────────────────────────────────── */

function setMode(mode) {
  gameMode = mode;
  document.querySelectorAll('.mode-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'mode-' + mode);
  });
  document.getElementById('difficulty-card').style.display = mode === 'ai' ? '' : 'none';

  if (mode === 'ai' && game.turn === 'b' && !game.isGameOver() && !aiThinking) {
    checkAI();
  }
}

/* ─── Init ───────────────────────────────────────────────────────── */

function init() {
  // Draw board
  newGame();

  // Button handlers
  document.getElementById('btn-new-game').addEventListener('click', newGame);
  document.getElementById('btn-undo').addEventListener('click', undoMove);
  document.getElementById('mode-1v1').addEventListener('click', () => setMode('1v1'));
  document.getElementById('mode-ai').addEventListener('click', () => setMode('ai'));

  // Difficulty selector
  document.querySelectorAll('.difficulty-selector button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.difficulty-selector button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      aiDepth = parseInt(btn.dataset.depth, 10);
    });
  });

  // Eval bar toggle
  document.getElementById('eval-toggle').addEventListener('change', (e) => {
    showEvalBar = e.target.checked;
    updateEvalBar();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'u' || e.key === 'z') {
      if (!e.ctrlKey && !e.metaKey) undoMove();
    }
    if (e.key === 'n') newGame();
  });

  console.log('Chess UI initialized');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}