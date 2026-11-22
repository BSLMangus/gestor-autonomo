/**
 * Validador estricto de NIF, NIE y CIF españoles por dígito de control.
 */

const NIF_CONTROL_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_CONTROL_LETTERS = "JABCDEFGHI";

export function validateSpanishTaxId(raw: string): boolean {
  const id = raw.trim().toUpperCase();
  if (id.length !== 9) {
    return false;
  }

  // NIF estándar: 8 dígitos + letra de control
  if (/^\d{8}[A-Z]$/.test(id)) {
    const num = Number(id.slice(0, 8));
    const expected = NIF_CONTROL_LETTERS[num % 23];
    return id[8] === expected;
  }

  // NIE: X/Y/Z + 7 dígitos + letra de control
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const prefixMap: Record<string, string> = { X: "0", Y: "1", Z: "2" };
    const mappedPrefix = prefixMap[id[0] ?? ""];
    if (!mappedPrefix) return false;
    const num = Number(mappedPrefix + id.slice(1, 8));
    const expected = NIF_CONTROL_LETTERS[num % 23];
    return id[8] === expected;
  }

  // NIF especial (K, L, M): letra + 7 dígitos + letra
  if (/^[KLM]\d{7}[A-Z]$/.test(id)) {
    const num = Number(id.slice(1, 8));
    const expected = NIF_CONTROL_LETTERS[num % 23];
    return id[8] === expected;
  }

  // CIF: letra organización + 7 dígitos + dígito o letra de control
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {
    const letter = id[0] ?? "";
    const digits = id.slice(1, 8);
    const control = id[8] ?? "";

    let evenSum = 0;
    let oddSum = 0;
    for (let i = 0; i < 7; i += 1) {
      const digit = Number(digits[i]);
      if ((i + 1) % 2 === 0) {
        // Posiciones pares (2ª, 4ª, 6ª -> índices 1, 3, 5)
        evenSum += digit;
      } else {
        // Posiciones impares (1ª, 3ª, 5ª, 7ª -> índices 0, 2, 4, 6)
        const doubled = digit * 2;
        oddSum += Math.floor(doubled / 10) + (doubled % 10);
      }
    }

    const total = evenSum + oddSum;
    const controlDigit = (10 - (total % 10)) % 10;
    const expectedDigitChar = String(controlDigit);
    const expectedLetterChar = CIF_CONTROL_LETTERS[controlDigit] ?? "";

    if ("PQRSNW".includes(letter)) {
      return control === expectedLetterChar;
    }
    if ("ABEH".includes(letter)) {
      return control === expectedDigitChar;
    }
    return control === expectedDigitChar || control === expectedLetterChar;
  }

  return false;
}
