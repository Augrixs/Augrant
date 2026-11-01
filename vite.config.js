export default {
  base: './',
  build: {
    outDir: 'dist',
    target: 'esnext',
    chunkSizeWarningLimit: 8000,
  },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
};
