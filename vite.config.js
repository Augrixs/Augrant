export default {
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 8000,
  },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
};
