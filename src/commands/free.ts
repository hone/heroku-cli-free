import {Command, flags} from '@heroku-cli/command'
import * as Heroku from '@heroku-cli/schema'
import color from '@heroku-cli/color'
import {cli} from 'cli-ux'

const supports = require('supports-hyperlinks')
const hyperlinker = require('hyperlinker')

interface FreeInfo {
  dyno: boolean;
  postgresql: Array<string>;
  redis: Array<string>;
}

type Entry = {
  name: string;
  team?: string;
  free: FreeInfo;
}

export default class FreeCommand extends Command {
  static description = 'find your apps using free dynos and data'

  static flags = {
    help: flags.help({char: 'h'}),
  }

  async getApps(): Promise<Array<Heroku.App>> {
    const headers = {Accept: 'application/vnd.heroku+json; version=3.process-tier'}
    const response = await this.heroku.get<Array<Heroku.App>>('/apps', {headers})
    return response.body
  }

  async getAddons(): Promise<Array<Heroku.AddOn>> {
    const headers = {Accept: 'application/vnd.heroku+json; version=3.heroku-addons-filter'}
    const response = await this.heroku.get<Array<Heroku.AddOn>>('/addons?slug%5B%5D=heroku-postgresql&slug%5B%5D=heroku-redis', {headers})
    return response.body
  }

  async freeDynos(apps: Array<Heroku.App>): Promise<Array<Entry>> {
    return apps.filter(app => app.process_tier === 'free').map(app => {
      return {
        name: app.name,
        team: app.team ? app.team.name : undefined,
        free: {
          dyno: true,
          postgresql: [],
          redis: [],
        },
      } as Entry
    })
  }

  async freeData(addons: Array<Heroku.AddOn>, apps: Array<Heroku.App>): Promise<Array<Entry>> {
    return addons.filter(addon => {
      return addon.app && addon.addon_service && addon.plan && addon.plan.name !== undefined ? /heroku-(postgresql|redis):(dev|hobby-dev|test)/.exec(addon.plan.name) : false
    }).map(addon => {
      return {
        name: addon.app!.name,
        team: (function (apps: Array<Heroku.App>, name: string): string | undefined {
          const app = apps.find(app => app.name === name)

          if (app) {
            if (app.organization) {
              return app.organization.name
            }

            if (app.team) {
              return app.team.name
            }
          }

          return undefined
        })(apps, addon.app!.name!),
        free: {
          dyno: false,
          // filtered for this above
          postgresql: addon.addon_service!.name === 'heroku-postgresql' ? [addon.name] : [],
          redis: addon.addon_service!.name === 'heroku-redis' ? [addon.name] : [],
        },
      } as Entry
    })
  }

  async run() {
    // const {flags} = this.parse(FreeCommand)
    cli.action.start('Fetching data')

    const apps = await this.getApps()
    const addons = await this.getAddons()
    const freeDynos = await this.freeDynos(apps)
    const freeData = await this.freeData(addons, apps)

    // aggregate data
    const data = new Map<string, Entry>()
    for (const entry of [...freeDynos, ...freeData]) {
      let result = data.get(entry.name)
      if (result) {
        if (entry.free.dyno) result.free.dyno = true
        if (entry.free.postgresql.length > 0) result.free.postgresql.push(entry.free.postgresql[0])
        if (entry.free.redis.length > 0) result.free.redis.push(entry.free.redis[0])
      } else {
        result = entry
      }

      data.set(entry.name, result)
    }

    cli.action.stop()

    cli.styledHeader('Apps with Free Dynos & Data')
    cli.table([...data.values()], {
      name: {
        minWidth: 7,
        get: row => supports.stdout ? hyperlinker(row.name, `https://dashboard.heroku.com/apps/${row.name}/resources`) : row.name,
      },
      team: {
        get: row => {
          if (row.team) {
            return supports.stdout ? hyperlinker(row.team, `https://dashboard.heroku.com/teams/${row.team}/apps`) : row.team
          }

          return 'none'
        },
      },
      dyno: {
        get: row => row.free.dyno ? color.red('true') : 'none',
      },
      postgresql: {
        get: row => row.free.postgresql.length > 0 ? color.red(row.free.postgresql.join(',')) : 'none',
      },
      redis: {
        get: row => row.free.redis.length > 0 ? color.red(row.free.redis.join(',')) : 'none',
      },
    })
  }
}
