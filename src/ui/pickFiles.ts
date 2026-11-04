/** Abre el selector de archivos del sistema sin dibujar un input nativo. */
export function pickFiles({ accept, multiple = false, onPick }: { accept: string; multiple?: boolean; onPick: (files: FileList | null) => void }) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  input.onchange = () => onPick(input.files);
  input.click();
}
