interface Branch<T> { value: T; left: Branch<T> | null; right: Branch<T> | null; height: number; size: number }
const height = <T>(node: Branch<T> | null) => node?.height ?? 0;
const size = <T>(node: Branch<T> | null) => node?.size ?? 0;
function update<T>(node: Branch<T>) {
  node.height = 1 + Math.max(height(node.left), height(node.right));
  node.size = 1 + size(node.left) + size(node.right);
  return node;
}
function rotateRight<T>(node: Branch<T>) {
  const head = node.left!; node.left = head.right; head.right = update(node); return update(head);
}
function rotateLeft<T>(node: Branch<T>) {
  const head = node.right!; node.right = head.left; head.left = update(node); return update(head);
}
function balance<T>(node: Branch<T>) {
  update(node);
  if (height(node.left) - height(node.right) > 1) {
    if (height(node.left!.left) < height(node.left!.right)) node.left = rotateLeft(node.left!);
    return rotateRight(node);
  }
  if (height(node.right) - height(node.left) > 1) {
    if (height(node.right!.right) < height(node.right!.left)) node.right = rotateRight(node.right!);
    return rotateLeft(node);
  }
  return node;
}

/** Ordered waiting requests with logarithmic insertion, removal and prefix counts.
 * Prefix counts preserve feasible-first bypass diagnostics without walking a backlog.
 * Keys must stay unchanged while an item is queued, and compare must be a total order.
 */
export class RequestQueue<T> {
  private root: Branch<T> | null = null;
  constructor(private readonly compare: (a: T, b: T) => number) {}
  get size() { return size(this.root); }
  peek(): T | undefined {
    let node = this.root; if (!node) return undefined;
    while (node.left) node = node.left;
    return node.value;
  }
  push(value: T) {
    const add = (node: Branch<T> | null): Branch<T> => {
      if (!node) return { value, left: null, right: null, height: 1, size: 1 };
      const order = this.compare(value, node.value);
      if (order < 0) node.left = add(node.left);
      else if (order > 0) node.right = add(node.right);
      else throw new Error('Invariant: duplicate queued request.');
      return balance(node);
    };
    this.root = add(this.root);
  }
  remove(value: T) {
    const drop = (node: Branch<T> | null, target: T): Branch<T> | null => {
      if (!node) return null;
      const order = this.compare(target, node.value);
      if (order < 0) node.left = drop(node.left, target);
      else if (order > 0) node.right = drop(node.right, target);
      else {
        if (!node.left) return node.right;
        if (!node.right) return node.left;
        let successor = node.right; while (successor.left) successor = successor.left;
        node.value = successor.value; node.right = drop(node.right, successor.value);
      }
      return balance(node);
    };
    this.root = drop(this.root, value);
  }
  countBefore(value: T): number {
    let count = 0; let node = this.root;
    while (node) {
      if (this.compare(node.value, value) < 0) { count += 1 + size(node.left); node = node.right; }
      else node = node.left;
    }
    return count;
  }
}
