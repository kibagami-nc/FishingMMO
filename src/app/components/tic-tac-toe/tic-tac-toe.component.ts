import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-tic-tac-toe',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './tic-tac-toe.component.html',
    styleUrls: ['./tic-tac-toe.component.css']
})
export class TicTacToeComponent implements OnInit {
    board: string[] = Array(9).fill('');
    isPlayerTurn = true;
    winner: string | null = null;
    isDraw = false;

    // History tracking (indices)
    playerMoves: number[] = [];
    aiMoves: number[] = [];

    ngOnInit() { }

    makeMove(index: number) {
        if (this.board[index] || this.winner || !this.isPlayerTurn) return;

        this.board[index] = 'X';
        this.playerMoves.push(index);

        // Rule: Keep only last 3 moves
        if (this.playerMoves.length > 3) {
            const oldIndex = this.playerMoves.shift()!;
            this.board[oldIndex] = '';
        }

        if (this.checkWinner()) return;

        this.isPlayerTurn = false;
        setTimeout(() => this.aiMove(), 600);
    }

    aiMove() {
        if (this.winner || this.isDraw) return;

        const move = this.getBestMove();
        if (move !== -1) {
            this.board[move] = 'O';
            this.aiMoves.push(move);

            if (this.aiMoves.length > 3) {
                const oldIndex = this.aiMoves.shift()!;
                this.board[oldIndex] = '';
            }

            this.checkWinner();
        }
        this.isPlayerTurn = true;
    }

    getBestMove(): number {
        const available = this.board.map((v, i) => v === '' ? i : null).filter(v => v !== null) as number[];
        if (available.length === 0) return -1;

        // 1. Try to win
        for (const move of available) {
            if (this.simWin(move, 'O')) return move;
        }

        // 2. Block player win
        for (const move of available) {
            if (this.simWin(move, 'X')) return move;
        }

        // 3. Take center
        if (available.includes(4)) return 4;

        // 4. Random
        return available[Math.floor(Math.random() * available.length)];
    }

    simWin(index: number, mark: string): boolean {
        const tempBoard = [...this.board];
        tempBoard[index] = mark;
        const lines = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];
        for (const [a, b, c] of lines) {
            if (tempBoard[a] === mark && tempBoard[b] === mark && tempBoard[c] === mark) return true;
        }
        return false;
    }

    checkWinner(): boolean {
        const lines = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
            [0, 4, 8], [2, 4, 6]             // diags
        ];

        for (const [a, b, c] of lines) {
            if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
                this.winner = this.board[a];
                return true;
            }
        }

        return false;
    }

    resetGame() {
        this.board = Array(9).fill('');
        this.playerMoves = [];
        this.aiMoves = [];
        this.isPlayerTurn = true;
        this.winner = null;
        this.isDraw = false;
    }
}
