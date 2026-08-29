import figma from '@figma/code-connect'
import { DeviceSelect } from './DeviceSelect'

figma.connect(DeviceSelect, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=19-2', {
  example: () => (<DeviceSelect ariaLabel="Audio device" items={[{ id: 'device', label: 'Audio interface', lowLatency: true }]} value="device" open={false} onToggle={() => {}} onSelect={() => {}} />),
})
