// A tiny, safe evaluator for the scoring formulas written in data/scoring.json, for example
//   "100*(1-4*(1-p)**2)"   and   "100*(1+log2(p))".
// The Python simulators evaluate the very same strings, so the app and the simulators cannot drift apart.
// Grammar: + - * / ** (right to left, like Python), unary minus, parentheses, numbers, the names in `vars`,
// and the functions log2, log10, ln, sqrt, abs. Nothing else is allowed, and nothing is ever passed to eval().

const FUNCTIONS = {
  log2: Math.log2,
  log10: Math.log10,
  ln: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
};

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|[-+*/(),]))/gy;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new Error(`Unexpected character at ${pos} in formula "${src}"`);
    }
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] });
  }
  return tokens;
}

export function compile(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;

  function parseExpr() {
    let left = parseTerm();
    while (isOp('+') || isOp('-')) {
      const op = take().v;
      const right = parseTerm();
      const l = left;
      left = op === '+' ? (vars) => l(vars) + right(vars) : (vars) => l(vars) - right(vars);
    }
    return left;
  }
  function parseTerm() {
    let left = parseUnary();
    while (isOp('*') || isOp('/')) {
      const op = take().v;
      const right = parseUnary();
      const l = left;
      left = op === '*' ? (vars) => l(vars) * right(vars) : (vars) => l(vars) / right(vars);
    }
    return left;
  }
  function parseUnary() {
    if (isOp('-')) { take(); const x = parseUnary(); return (vars) => -x(vars); }
    if (isOp('+')) { take(); return parseUnary(); }
    return parsePower();
  }
  function parsePower() {
    const base = parseAtom();
    if (isOp('**')) {
      take();
      const exp = parseUnary(); // right to left, and 2 ** -1 works, as in Python
      return (vars) => Math.pow(base(vars), exp(vars));
    }
    return base;
  }
  function parseAtom() {
    const tok = take();
    if (!tok) throw new Error(`Formula ended early: "${src}"`);
    if (tok.t === 'num') return () => tok.v;
    if (tok.t === 'id') {
      if (isOp('(')) {
        take();
        const fn = FUNCTIONS[tok.v];
        if (!fn) throw new Error(`Unknown function ${tok.v} in "${src}"`);
        const arg = parseExpr();
        if (!isOp(')')) throw new Error(`Missing ) in "${src}"`);
        take();
        return (vars) => fn(arg(vars));
      }
      return (vars) => {
        // Own properties only: names like __proto__ or constructor must never resolve.
        if (!Object.prototype.hasOwnProperty.call(vars, tok.v) || typeof vars[tok.v] !== 'number') {
          throw new Error(`Unknown name ${tok.v} in "${src}"`);
        }
        return vars[tok.v];
      };
    }
    if (tok.t === 'op' && tok.v === '(') {
      const inner = parseExpr();
      if (!isOp(')')) throw new Error(`Missing ) in "${src}"`);
      take();
      return inner;
    }
    throw new Error(`Unexpected "${tok.v}" in "${src}"`);
  }

  const fn = parseExpr();
  if (i !== tokens.length) throw new Error(`Unexpected "${tokens[i].v}" in "${src}"`);
  return fn;
}
