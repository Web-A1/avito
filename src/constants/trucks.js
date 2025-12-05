/**
 * Константы для марок самосвалов
 * Список марок для генерации технических характеристик (Блок 7)
 */

export const TRUCK_BRANDS = [
  "Shacman",
  "FAW",
  "Sinotruk",
  "Foton",
  "Dongfeng",
  "JAC",
  "Howo",
  "Shaanxi",
  "Beiben",
  "CAMC",
  "Dayun",
  "JMC",
  "Scania",
  "Volvo",
  "Iveco",
  "MAN",
  "Mercedes-Benz",
  "DAF",
  "Renault",
  "Ford"
];

/**
 * Генерирует случайный номер машины от 010 до 999 (трехзначный с ведущим нулем)
 * @returns {string} Номер машины (например, "196", "010", "999")
 */
export function generateTruckNumber() {
  const number = Math.floor(Math.random() * 990) + 10; // От 10 до 999
  return number.toString().padStart(3, '0'); // Дополняем нулями слева до 3 цифр
}

/**
 * Генерирует случайную марку самосвала
 * @returns {string} Марка самосвала
 */
export function getRandomTruckBrand() {
  return TRUCK_BRANDS[Math.floor(Math.random() * TRUCK_BRANDS.length)];
}

