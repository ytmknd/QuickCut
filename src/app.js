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
            if (e.target.matches('input, textarea')) return;
            
            // C key for cut
            if (e.key === 'c' || e.key === 'C') {
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+C / Cmd+C for copy
                    e.preventDefault();
                    this.timelineManager.copySelectedClip();
                } else {
                    // Just C for cut
                    this.timelineManager.cutClipAtPlayhead();
                }
            }
            // Ctrl+V / Cmd+V for paste
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
                e.preventDefault();
                this.timelineManager.pasteClip();
            }
            // Delete or Backspace key for delete
            else if (e.key === 'Delete' || e.key === 'Backspace') {
                this.timelineManager.deleteSelectedClip();
            }
            // S key to toggle snap
            else if (e.key === 's' || e.key === 'S') {
                this.timelineManager.toggleSnap();
            }
        });
    }
}

window.app = new App();
