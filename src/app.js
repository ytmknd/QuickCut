import { AssetsManager } from './assets.js';
import { TimelineManager } from './timeline.js';
import { PreviewPlayer } from './preview.js';
import { Exporter } from './export.js';

class App {
    constructor() {
        this.assetsManager = new AssetsManager(this);
        this.timelineManager = new TimelineManager(this);
        this.previewPlayer = new PreviewPlayer(this);
        this.exporter = new Exporter(this);

        this.init();
    }

    init() {
        console.log('QuickCut Initialized');

        // Check if SharedArrayBuffer is available
        if (typeof SharedArrayBuffer === 'undefined') {
            console.warn('==========================================');
            console.warn('WARNING: Export functionality is disabled!');
            console.warn('==========================================');
            console.warn('SharedArrayBuffer is not available.');
            console.warn('This means the required HTTP headers are missing.');
            console.warn('');
            console.warn('To enable video export:');
            console.warn('  1. Stop Live Server');
            console.warn('  2. Run: node server.js');
            console.warn('  3. Open: http://localhost:3000');
            console.warn('==========================================');
        } else {
            console.log('✓ SharedArrayBuffer available - Export enabled');
        }

        // Global event listeners or initial setup
        window.addEventListener('resize', () => {
            this.timelineManager.handleResize();
            this.previewPlayer.handleResize();
        });

        // Undo/Redo buttons
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                this.timelineManager.historyManager.undo();
            });
        }

        const redoBtn = document.getElementById('redo-btn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                this.timelineManager.historyManager.redo();
            });
        }



        // Cut clip button
        const cutBtn = document.getElementById('cut-btn');
        if (cutBtn) {
            cutBtn.addEventListener('click', () => {
                this.timelineManager.cutClipAtPlayhead();
            });
        }

        // Delete clip button
        const deleteBtn = document.getElementById('delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.timelineManager.deleteSelectedClip();
            });
        }

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            // console.log('Key pressed:', e.key, 'Ctrl:', e.ctrlKey, 'Meta:', e.metaKey);
            if (e.target.matches('input, textarea')) return;

            // C key for cut (Split)
            if (e.code === 'KeyC') {
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+C / Cmd+C for copy
                    e.preventDefault();
                    this.timelineManager.copySelectedClip();
                } else {
                    // Just C for split (cut at playhead)
                    this.timelineManager.cutClipAtPlayhead();
                }
            }
            // Ctrl+X / Cmd+X for Cut (Copy + Delete)
            else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyX')) {
                console.log('Ctrl+X detected');
                e.preventDefault();
                this.timelineManager.cutSelectedClip();
            }
            // Ctrl+V / Cmd+V for paste
            else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyV')) {
                e.preventDefault();
                this.timelineManager.pasteClip();
            }
            // Delete or Backspace key for delete
            else if (e.code === 'Delete' || e.code === 'Backspace') {
                this.timelineManager.deleteSelectedClip();
            }
            // S key to toggle snap
            else if (e.code === 'KeyS') {
                this.timelineManager.toggleSnap();
            }
            // Ctrl+Z for Undo
            else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ')) {
                if (e.shiftKey) {
                    // Ctrl+Shift+Z for Redo
                    e.preventDefault();
                    this.timelineManager.historyManager.redo();
                } else {
                    // Ctrl+Z for Undo
                    e.preventDefault();
                    this.timelineManager.historyManager.undo();
                }
            }
            // Ctrl+Y for Redo
            else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY')) {
                e.preventDefault();
                this.timelineManager.historyManager.redo();
            }
        });
    }
}

window.app = new App();
