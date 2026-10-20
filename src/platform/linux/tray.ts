import { ElectronTrayProvider } from '../tray-provider';

/** Linux tray: 22px icon for panel scaling, single-click shows the window. */
export class LinuxTray extends ElectronTrayProvider {
  constructor() {
    super(22, true);
  }
}
