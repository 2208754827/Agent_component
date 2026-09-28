/**
 * 入口（占位）。
 *
 * 约定：纯函数写在各自的组件文件里（一个组件 = 一个导出函数），
 * 副作用（网络请求、读写文件、console 输出）只允许出现在入口这一层。
 */

export const greet = (name: string): string => `agent-component ready: ${name}`;

console.log(greet("empty skeleton"));
