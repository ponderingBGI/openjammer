import figma from '@figma/code-connect'
import { CodeBlock } from './CodeBlock'

figma.connect(CodeBlock, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=11-25', {
  example: () => (<CodeBlock />),
})
