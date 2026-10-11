import {Image,type ImageSourcePropType} from 'react-native';
import {CalendarDays,Mail} from 'lucide-react-native';
import {useAppTheme} from './app-theme';
const artwork:Record<string,ImageSourcePropType>={
  wechat:require('../assets/platforms/wechat.jpg'),douyin:require('../assets/platforms/douyin.jpg'),
  xiaohongshu:require('../assets/platforms/xiaohongshu.jpg'),bilibili:require('../assets/platforms/bilibili.jpg'),
  feishu:require('../assets/platforms/feishu.jpg'),dingtalk:require('../assets/platforms/dingtalk.jpg'),
  wecom:require('../assets/platforms/wecom.jpg'),github:require('../assets/platforms/github.jpg'),
};
/** Locally bundled publisher artwork; no third-party request when choosing apps. */
export function PlatformIcon({id,size=28}:{id:string;size?:number}){
 const {colors:c}=useAppTheme();
 if(artwork[id])return <Image accessible={false} source={artwork[id]} style={{width:size,height:size,borderRadius:7}}/>;
 const Icon=id==='calendar'?CalendarDays:Mail;return <Icon size={size-3} color={c.ink}/>;
}
