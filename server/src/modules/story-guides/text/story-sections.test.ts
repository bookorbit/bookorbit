import { isMatterTitle } from './story-sections';

describe('matter titles', () => {
  it.each(['Índice', 'ÍNDICE GENERAL', 'Contenido', 'Dedicatoria', 'Agradecimientos', 'Sobre el autor', 'Acerca de la autora', 'Notas', 'Glosario'])(
    'reads the Spanish %j as front or back matter',
    (title) => {
      expect(isMatterTitle(title)).toBe(true);
    },
  );

  it.each(['Capítulo I', 'I. Perdido', 'Prólogo', 'Epílogo', 'La Nela', 'Prefacio'])('reads %j as story', (title) => {
    expect(isMatterTitle(title)).toBe(false);
  });

  it('reads the English titles as before', () => {
    expect(isMatterTitle('Acknowledgements')).toBe(true);
    expect(isMatterTitle('About the Author')).toBe(true);
    expect(isMatterTitle('Chapter 1')).toBe(false);
  });
});
