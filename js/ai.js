/**
 * ai.js — Chess AI with Minimax + Alpha-Beta Pruning
 *
 * Usage (Node.js):
 *   const Chess = require('./chess.js');
 *   const { findBestMove } = require('./ai.js');
 *   const game = new Chess();
 *   const bestMove = findBestMove(game, 4);
 *
 * Usage (Browser):
 *   Loaded via script tags; uses window.Chess and window.evaluate.
 */

(function() {
  'use strict';

  var Chess, evaluate;
  if (typeof module !== 'undefined' && module.exports) {
    Chess = require('./chess.js');
    evaluate = require('./evaluation.js');
  } else {
    Chess = window.Chess;
    evaluate = window.evaluate;
  }

  var INFINITY = 9999999;
  var MATE_DISTANCE_BONUS = 4;

  function scoreMove(move, game) {
    var score = 0;
    var fromRC = game._sqToRC(move.from);
    var toRC = game._sqToRC(move.to);
    var piece = game.board[fromRC.r][fromRC.c];
    var captured = game.board[toRC.r][toRC.c];

    if (captured !== '.') {
      var victimValue = getPieceValue(captured.toUpperCase());
      var attackerValue = getPieceValue(piece.toUpperCase());
      score += 10 * victimValue - attackerValue;
    }

    if (move.flags.indexOf('p') !== -1 || move.flags.indexOf('pc') !== -1) {
      var promoValue = getPieceValue(move.promotion.toUpperCase());
      score += promoValue;
    }

    var centerSquares = ['d4', 'd5', 'e4', 'e5'];
    if (centerSquares.indexOf(move.to) !== -1) {
      score += 10;
    }

    return score;
  }

  function getPieceValue(type) {
    var values = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
    return values[type] || 0;
  }

  function orderMoves(moves, game) {
    return moves
      .map(function(m) { return { move: m, score: scoreMove(m, game) }; })
      .sort(function(a, b) { return b.score - a.score; })
      .map(function(entry) { return entry.move; });
  }

  function minimax(game, depth, alpha, beta, color) {
    if (game.isCheckmate()) {
      // color is the side in checkmate
      // score convention: positive = good for white, negative = good for black
      var mateDistance = MATE_DISTANCE_BONUS - depth;
      return (color === 'w') ? -INFINITY + mateDistance : INFINITY - mateDistance;
    }
    if (game.isDraw()) {
      return 0;
    }

    if (depth === 0) {
      return evaluate(game);
    }

    var legalMoves = game.getLegalMoves();

    if (legalMoves.length === 0) {
      return 0;
    }

    var ordered = orderMoves(legalMoves, game);
    var score;

    if (color === 'w') {
      var maxEval = -INFINITY;
      for (var i = 0; i < ordered.length; i++) {
        game.makeMove(ordered[i]);
        score = minimax(game, depth - 1, alpha, beta, 'b');
        game.undo();

        if (score > maxEval) maxEval = score;
        if (maxEval > alpha) alpha = maxEval;
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      var minEval = INFINITY;
      for (var i = 0; i < ordered.length; i++) {
        game.makeMove(ordered[i]);
        score = minimax(game, depth - 1, alpha, beta, 'w');
        game.undo();

        if (score < minEval) minEval = score;
        if (minEval < beta) beta = minEval;
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  function findBestMove(game, depth) {
    if (depth === undefined) depth = 4;
    var color = game.turn;
    var legalMoves = game.getLegalMoves();

    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    var ordered = orderMoves(legalMoves, game);

    var bestMove = ordered[0];
    var bestScore = (color === 'w') ? -INFINITY : INFINITY;

    var alpha = -INFINITY;
    var beta = INFINITY;
    var score;

    for (var i = 0; i < ordered.length; i++) {
      game.makeMove(ordered[i]);
      score = minimax(game, depth - 1, alpha, beta, color === 'w' ? 'b' : 'w');
      game.undo();

      if (color === 'w') {
        if (score > bestScore) {
          bestScore = score;
          bestMove = ordered[i];
        }
        if (score > alpha) alpha = score;
      } else {
        if (score < bestScore) {
          bestScore = score;
          bestMove = ordered[i];
        }
        if (score < beta) beta = score;
      }
    }

    return bestMove;
  }

  function getScore(game) {
    return evaluate(game);
  }

  // Exports
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { findBestMove: findBestMove, getScore: getScore };
  }
  if (typeof window !== 'undefined') {
    window.findBestMove = findBestMove;
    window.getScore = getScore;
  }
})();