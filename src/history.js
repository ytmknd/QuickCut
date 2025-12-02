export class HistoryManager {
    constructor(timelineManager) {
        this.timelineManager = timelineManager;
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 50;
    }

    pushState() {
        // Deep copy the current state
        const state = this.captureState();

        this.undoStack.push(state);

        // Limit history size
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }

        // Clear redo stack when new action is performed
        this.redoStack = [];

        this.updateUI();
    }

    captureState() {
        // Deep clone tracks to avoid reference issues
        // We need to clone the array structure and the clip objects
        const tracks = {};
        for (const trackId in this.timelineManager.tracks) {
            tracks[trackId] = this.timelineManager.tracks[trackId].map(clip => ({ ...clip }));
        }

        return {
            tracks: tracks,
            duration: this.timelineManager.duration
        };
    }

    undo() {
        if (!this.canUndo()) return;

        // Save current state to redo stack before undoing
        const currentState = this.captureState();
        this.redoStack.push(currentState);

        // Pop previous state
        const prevState = this.undoStack.pop();
        this.restoreState(prevState);

        this.updateUI();
        console.log('Undo performed');
    }

    redo() {
        if (!this.canRedo()) return;

        // Save current state to undo stack before redoing
        const currentState = this.captureState();
        this.undoStack.push(currentState);

        // Pop next state
        const nextState = this.redoStack.pop();
        this.restoreState(nextState);

        this.updateUI();
        console.log('Redo performed');
    }

    restoreState(state) {
        // Restore tracks
        this.timelineManager.tracks = state.tracks;
        this.timelineManager.duration = state.duration;

        // Re-render everything
        this.timelineManager.renderAllClips();
        this.timelineManager.renderRuler();

        // Update preview
        this.timelineManager.app.previewPlayer.seek(this.timelineManager.currentTime);
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    updateUI() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');

        if (undoBtn) undoBtn.disabled = !this.canUndo();
        if (redoBtn) redoBtn.disabled = !this.canRedo();
    }
}
