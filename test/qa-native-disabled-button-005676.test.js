import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { transform } from 'esbuild';

const app = await readFile(process.env.QA_BOOKING_REPAIR_SOURCE_FILE || new URL('../src/App.jsx', import.meta.url), 'utf8');
const begin = app.indexOf('function Btn(');
const { code } = await transform(app.slice(begin, app.indexOf('function Modal(', begin)), { loader: 'jsx' });
const Btn = new Function('React', 'C', code + ';return Btn;')(React, {});

test('BUG-005676 disabled booking actions are disabled native controls and cannot activate', () => {
  let activations = 0;
  for (const disabled of [true, false]) {
    const tree = Btn({ children: 'Reserve & pay', disabled, onClick: () => activations++ });
    const dom = new JSDOM(renderToStaticMarkup(tree));
    const button = dom.window.document.querySelector('button');
    assert.equal(button.disabled, disabled);
    if (tree.props.onClick) button.addEventListener('click', tree.props.onClick);
    button.click();
    assert.equal(activations, disabled ? 0 : 1);
    dom.window.close();
  }
});
