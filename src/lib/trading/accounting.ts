export interface BookSide {
  cash: number;
  qty: number;
  avgPrice: number;
}

export function applyBuy(book: BookSide, fillPrice: number, qty: number, fee: number): BookSide {
  const nextQty = book.qty + qty;
  const avgPrice = nextQty > 0 ? (book.avgPrice * book.qty + fillPrice * qty + fee) / nextQty : 0;
  return {
    cash: book.cash - fillPrice * qty - fee,
    qty: nextQty,
    avgPrice,
  };
}

export function applySell(book: BookSide, fillPrice: number, qty: number, fee: number): BookSide & { realizedPnl: number } {
  const size = Math.min(qty, book.qty);
  const proceeds = fillPrice * size - fee;
  const realizedPnl = proceeds - book.avgPrice * size;
  const nextQty = book.qty - size;
  return {
    cash: book.cash + proceeds,
    qty: nextQty,
    avgPrice: nextQty > 1e-12 ? book.avgPrice : 0,
    realizedPnl,
  };
}
